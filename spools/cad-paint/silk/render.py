"""CPU path trace the saved CAD solids and record visible part ownership."""

import mitsuba as mi
import numpy as np
from PIL import Image

mi.set_variant("scalar_rgb")
transform = mi.ScalarTransform4f
size = (960, 680)


def direction(yaw, elevation):
    y, e = np.radians([yaw, elevation])
    return np.array([np.cos(y)*np.cos(e), np.sin(y)*np.cos(e), np.sin(e)])


def rounded_box(folder, solid, index):
    # A cube-face grid samples the flat, cylindrical and spherical bevel regions.
    half = np.array(solid["size"])/2
    radius = solid["bevel"]
    core = half - radius
    vertices, normals, triangles = [], [], []
    def ticks(axis):
        h, c = half[axis], core[axis]
        return np.r_[np.linspace(-h, -c, 5), np.linspace(c, h, 5)]
    for axis in range(3):
        u, v = (axis+1)%3, (axis+2)%3
        for sign in [-1, 1]:
            start = len(vertices)
            for x in ticks(u):
                for y in ticks(v):
                    p = np.zeros(3)
                    p[axis], p[u], p[v] = sign*half[axis], x, sign*y
                    inner = np.clip(p, -core, core)
                    n = p-inner
                    n /= np.linalg.norm(n)
                    vertices.append(solid["center"]+inner+radius*n)
                    normals.append(n)
            for i in range(9):
                for j in range(9):
                    a = start + i*10 + j
                    triangles.extend([(a,a+10,a+11), (a,a+11,a+1)])
    path = folder / f"mesh-{index}.ply"
    with path.open("w") as f:
        f.write(f"ply\nformat ascii 1.0\nelement vertex {len(vertices)}\n")
        for prop in ["x","y","z","nx","ny","nz"]:
            f.write(f"property float {prop}\n")
        f.write(f"element face {len(triangles)}\nproperty list uchar int vertex_indices\nend_header\n")
        for p,n in zip(vertices,normals):
            f.write(" ".join(f"{c:.6f}" for c in [*p,*n])+"\n")
        for a,b,c in triangles:
            f.write(f"3 {a} {b} {c}\n")
    return {"type":"ply","filename":str(path)}


def rgb(color):
    return np.array(list(bytes.fromhex(color[1:]))) / 255


def render(folder, job):
    focus = np.array(job.get("focus", [4, 0, 18]))
    eye = direction(**job["camera"])
    sensor = {"type":"orthographic",
              "to_world":transform().look_at(origin=focus+220*eye,target=focus,up=[0,0,1]) @ transform().scale(job.get("width",155)/2),
              "film":{"type":"hdrfilm","width":size[0],"height":size[1],"pixel_format":"rgba",
                      "rfilter":{"type":"box"}}}
    scene = {"type":"scene","sensor":sensor}
    for index, solid in enumerate(job["solids"]):
        if solid["shape"] == "mesh":
            path = folder / f"mesh-{index}.ply"
            vertices, faces = solid["vertices"], solid["faces"]
            with path.open("w") as f:
                f.write(f"ply\nformat ascii 1.0\nelement vertex {len(vertices)}\n")
                f.write("property float x\nproperty float y\nproperty float z\n")
                f.write(f"element face {len(faces)}\nproperty list uchar int vertex_indices\nend_header\n")
                for x,y,z in vertices:
                    f.write(f"{x} {y} {z}\n")
                for a,b,c in faces:
                    f.write(f"3 {a} {b} {c}\n")
            obj = {"type":"ply", "filename":str(path), "face_normals":True}
        elif solid["shape"] == "box":
            obj = rounded_box(folder,solid,index)
        else:
            axis = "xyz".index(solid["axis"])
            half = np.zeros(3)
            half[axis] = solid["size"][axis]/2
            radius = solid["size"][(axis+1)%3]/2
            a, b = solid["center"]-half, solid["center"]+half
            obj = {"type":"cylinder","p0":a,"p1":b,"radius":radius}
            for side,point in enumerate((a,b)):
                scene[f'cap_{index}_{side}'] = {"type":"disk","to_world":transform().look_at(
                    origin=point,target=point+(-half if side==0 else half),up=np.roll(half,1)) @ transform().scale(radius),
                    "bsdf":{"type":"ref","id":"mat_"+solid["part"]}}
        obj["bsdf"] = {"type":"ref","id":"mat_"+solid["part"]}
        scene[f"solid_{index}"] = obj
    for part, m in job["materials"].items():
        scene["mat_"+part] = {"type":"principled","base_color":{"type":"rgb","value":rgb(m["color"])**2.2},
                             "metallic":m["metallic"],"roughness":m["roughness"]}
    for i,(az,el,power,scale) in enumerate([(job["light"],48,7,70),(job["light"]+125,42,4,58)]):
        pos = focus + 145*direction(az,el)
        scene[f"lamp_{i}"] = {"type":"rectangle","to_world":transform().look_at(origin=pos,target=focus,up=[0,0,1]) @ transform().scale(scale),
                              "emitter":{"type":"area","radiance":{"type":"rgb","value":power}}}
    scene["world"] = {"type":"constant","radiance":{"type":"rgb","value":0.55}}
    scene["integrator"] = {"type":"path","max_depth":6,"hide_emitters":True}
    world = mi.load_dict(scene,optimize=False)
    beauty = np.array(mi.render(world,spp=96,seed=17))
    alpha = np.clip(beauty[:,:,3:4],0,1)
    linear = beauty[:,:,:3] / np.maximum(alpha,1e-6)
    srgb = np.where(linear<=0.0031308,12.92*linear,1.055*np.maximum(0,linear)**(1/2.4)-0.055)
    rgba = np.concatenate([np.clip(srgb,0,1),alpha],axis=2)
    Image.fromarray(np.uint8(rgba*255+.5)).save(folder/"beauty.png")

    # Use a single centered ray per pixel for discrete labels. Never average IDs.
    sensor["sampler"] = {"type":"stratified","sample_count":1,"jitter":False}
    scene["integrator"] = {"type":"aov","aovs":"part:shape_index"}
    del scene["lamp_0"], scene["lamp_1"], scene["world"]
    mask_world = mi.load_dict(scene,optimize=False)
    labels = np.array(mi.render(mask_world,spp=1))[:,:,-1].astype(int)
    lookup = np.zeros((len(mask_world.shapes())+1,3), dtype=np.uint8)
    for i,shape in enumerate(mask_world.shapes(),1):
        name = shape.id().split("_")
        if name[0] in ("solid","cap"):
            part = job["solids"][int(name[1])]["part"]
            lookup[i] = np.uint8(rgb(job["ids"][part])*255)
    ids = lookup[labels]
    # Assign subpixel silhouette coverage to a neighboring visible part.
    missing = (alpha[:,:,0]>0) & ~ids.any(axis=2)
    for dy,dx in [(0,1),(0,-1),(1,0),(-1,0),(1,1),(-1,-1),(1,-1),(-1,1)]:
        neighbor = np.roll(ids,(dy,dx),(0,1))
        fill = missing & neighbor.any(axis=2)
        ids[fill] = neighbor[fill]
        missing[fill] = False
    Image.fromarray(ids).save(folder/"ids.png")
    for mesh in folder.glob("mesh-*.ply"):
        mesh.unlink()
