import { AnnotationEditor } from "./editor.js";
import { AnnotationEditorType } from "../../shared/util.js";

export class EraserEditor extends AnnotationEditor{
    static _type = "eraser";
    static _editorType = AnnotationEditorType.ERASER;

    constructor(params){
        super({ ...params, name: "eraserEditor" });
        console.log("Eraser constructor called");
    }
}