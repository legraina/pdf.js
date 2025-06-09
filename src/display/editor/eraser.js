import { AnnotationEditor } from "./editor.js";
import { AnnotationEditorType } from "../../shared/util.js";

export class EraserEditor extends AnnotationEditor{
    static _editorType = AnnotationEditorType.ERASER;

    constructor(params){
        super({ ...params, name: "eraserEditor" });
    }
}