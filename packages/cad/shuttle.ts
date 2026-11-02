import {geometry, parameterOf, type Model, type SavedDrawing} from './drawing.js';

// The studio owns the lock and supplies the epoch/revision it has just saved.
export function paintRequest(drawing:Model, scene:SavedDrawing, epoch:string, revision:number, direction:string) {
  return {
    schema:'cad-paint-request-v1' as const,
    intent:'render-visible-part-layers' as const,
    source:{application:'web-cad', document:drawing.id, epoch, revision},
    context:{description:drawing.description, direction},
    title:drawing.title, focus:drawing.focus, width:drawing.width,
    parts:drawing.parts, scene:structuredClone(scene),
    solids:geometry(drawing,parameterOf(scene)),
  };
}
