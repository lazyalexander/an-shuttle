# CAD painting assignment

Read the frozen request and README. The source identifies the CAD document, epoch and revision. The requested product is a transparent painting with one layer per visible part group. Use the supplied finishes, light and camera. Fit missing finishes to the part names, supplied palette and operator direction.

For a bounded edit, propose only a working copy of kit/appearance.py. Its function missing_material(part) returns finish, sRGB hex color, metallic and roughness for the requested missing part. Unsupported parts should fail. You may reuse a checked kit with matching inputs. Keep the stable renderer, part identities, product checks, release and CAD outside that edit. Changes to those contracts require reviewed development and a new release.

The local studio encodes validated material choices as literal-return branches. A general coding agent can use Loom's task and candidate reception for a different implementation. Its code needs host review and execution authority. A CAD request or a material prompt cannot grant either. The drawing software and downstream cutter are separate host effects.
