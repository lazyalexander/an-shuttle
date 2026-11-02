// Five printable part groups, millimetres. The wheel turns about the Y shaft.
part = "all";
angle = 0;
$fn = 56;
axis_z = 58;
module along_y(r,h) { rotate([-90,0,0]) cylinder(r=r,h=h); }
module foot() {
    difference() {
        hull() for(x=[-27,27], y=[-18,12]) translate([x,y,0]) cylinder(r=6,h=6);
        for(x=[-26,26], y=[-16,10]) translate([x,y,-1]) cylinder(r=2.6,h=8);
    }
    hull() {
        translate([-19,-15,5]) cube([38,14,3]);
        translate([0,-15,axis_z]) along_y(10,14);
    }
}
module bearing() {
    translate([0,-20,axis_z]) along_y(10,22);
    translate([0,-21,axis_z]) along_y(6,40);
}
module wheel() {
    rotate_extrude() translate([38,0]) scale([1,0.92]) circle(r=3.8,$fn=16);
    cylinder(r=8,h=8,center=true);
    for(a=[0,120,240]) rotate([0,0,a]) hull() {
        translate([4,0,0]) cylinder(r=3.3,h=5,center=true);
        translate([37,1,0]) cylinder(r=2.5,h=4.4,center=true);
    }
}
module crank() { translate([35,1,0]) cylinder(r=2.8,h=26); }
module grip() {
    translate([35,1,8]) {
        hull() for(z=[2,15]) translate([0,0,z]) cylinder(r=z==2?4.8:4.2,h=2);
        translate([0,0,18]) cylinder(r=3.4,h=1);
    }
}
if(part=="all" || part=="stand") foot();
if(part=="all" || part=="bearing") bearing();
translate([0,14,axis_z]) rotate([0,angle,0]) rotate([-90,0,0]) {
    if(part=="all" || part=="wheel") wheel();
    if(part=="all" || part=="pin") crank();
    if(part=="all" || part=="grip") grip();
}
