import { AnnotationEditor } from "./editor.js";
import { AnnotationEditorParamsType, AnnotationEditorType } from "../../shared/util.js";
import { noContextMenu } from "../display_utils.js";
import { InkEditor } from "./ink.js";

class PointerType {
  static current = null;

  constructor(editor) {
    if (PointerType.current === null) {
      PointerType.current = "";
      window.addEventListener("pointerdown", this.windowPointerDown, true);
    }
  }

  destroy() {
    if (PointerType.current !== null) {
      window.removeEventListener("pointerdown", this.windowPointerDown, true);
      PointerType.current = null;
    }
  }

  windowPointerDown(event) {
    PointerType.current = event.pointerType;
    return true;
  }
}
const pointerType = new PointerType();

export class EraserEditor extends AnnotationEditor{

    #eraserCursor = null;

    #disableEditing = false;

    #isPenDown = false;

    static _defaultThickness = 20;

    static _type = "eraser";

    static _editorType = AnnotationEditorType.ERASER;

    constructor(params){
        super({ ...params, name: "eraserEditor" });
        
        this.thickness = params.thickness || EraserEditor._defaultThickness;
        
        this.radius = this.thickness / 2;
        
        this.editorPointerType = null;

        this._updateCursor = this._updateCursor.bind(this);
        this._showCursor = this._showCursor.bind(this);
        this._hideCursor = this._hideCursor.bind(this);
        this._pointerDown = this._pointerDown.bind(this);
        this._pointerUp = this._pointerUp.bind(this);
    }

    destroy() {
      super.destroy();

      if(this.#eraserCursor){
        this.#eraserCursor.remove();
        this.#eraserCursor = null;
      }
    }

    /** @inheritdoc */
    static initialize(l10n, uiManager) {
      AnnotationEditor.initialize(l10n, uiManager);
    }
    
    /** @inheritdoc */
    static updateDefaultParams(type, value){
      switch(type){
        case AnnotationEditorParamsType.ERASER_THICKNESS:
          EraserEditor._defaultThickness = value;
          break;
      }
    }

    /** @inheritdoc */
    updateParams(type, value){
      switch(type){
        case AnnotationEditorParamsType.ERASER_THICKNESS:
          this.updateThickness(value);
          break;
      }
    }

    /** @inheritdoc */
    static get defaultPropertiesToUpdate(){
      return [
        [AnnotationEditorParamsType.ERASER_THICKNESS, EraserEditor._defaultThickness],
      ];
    }

    /** @inheritdoc */
    get propertiesToUpdate(){
      return [
        [
          AnnotationEditorParamsType.ERASER_THICKNESS,
          this.thickness || EraserEditor._defaultThickness,
        ],
      ];
    }

    updateThickness(thickness){
      const setThickness = th => {
        this.thickness = th;
        this.radius = th / 2;

        if(this.#eraserCursor){
        this.#eraserCursor.style.width = `${this.thickness}px`;
        this.#eraserCursor.style.height = `${this.thickness}px`;
        }
        const inkEditors = this.#getInkEditors();
        for (const inkEditor of inkEditors){
          inkEditor.updateEraseMode(true, this.thickness);
        }
      };

      const savedThickness = this.thickness;

      this.addCommands({
      cmd: setThickness.bind(this, thickness),
      undo: setThickness.bind(this, savedThickness),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.ERASER_THICKNESS,
      overwriteIfSameType: true,
      keepUndo: true,
    });
    EraserEditor._defaultThickness = thickness;

    this.eventBus?.dispatch("annotation-editor-event", {
      source: this,
      type: "thicknessChanged",
      page: this.pageIndex + 1,
      editorType: this.constructor.name,
      value: thickness,
      previousValue: savedThickness,
    });
    }

    setParent(parent) {
      if (!this.parent && parent) {
        // When attached to DOM, use ResizeObserver for scaling
        this._uiManager.removeShouldRescale(this);
      } else if (this.parent && parent === null) {
        // When detached from DOM, use manual scaling callback
        this._uiManager.addShouldRescale(this);
      }
      super.setParent(parent);
    }

    initializePointerType(){
      this.editorPointerType = PointerType.current;
    }

    resetPointerType(){
      this.editorPointerType = null;
    }

    /** @inheritdoc */
    rebuild(){
      if(!this.parent){
        return;
      }
      super.rebuild();
      if(this.div === null){
        return;
      }
      if(this.div){
        this.#updateDivSize();
      }
      if(!this.isAttachedToDOM){
        this.parent.add(this);
      }
      if (this.div.classList.contains("editing") && !this.isInEditMode()) {
        this.enableEditMode();
      }
    }

    /** @inheritdoc */
    remove(){
      const inkEditors = this.#getInkEditors();
      for(const inkEditor of inkEditors){
        inkEditor.updateEraseMode(false);
      }

      if(this.#eraserCursor){
        this.#eraserCursor.remove();
        this.#eraserCursor = null;
      }
      if(this.div && this.parent.div){
        this.parent.div.removeEventListener('pointermove', this._updateCursor);
        this.parent.div.removeEventListener('pointerdown', this._pointerDown);
        this.parent.div.removeEventListener('pointerup', this._pointerUp);
        this.parent.div.removeEventListener('pointercancel', this._pointerUp);
        this.parent.div.removeEventListener('pointerleave', this._hideCursor);
        this.div.width = this.div.height = 0;

        super.remove();

        this.div.remove();
        this.div = null;
      }
      else{
        super.remove();
      }
    }

    /** @inheritdoc */
    enableEditMode(){
      if(this.#disableEditing){
        return;
      }

      super.enableEditMode();

      if(this.#eraserCursor){
        this.#eraserCursor.remove();
        this.#eraserCursor = null;
      }
      this.#eraserCursor = document.createElement('div');
      this.#eraserCursor.className = 'eraserCursor';
      this.#eraserCursor.style.width = `${this.thickness}px`;
      this.#eraserCursor.style.height = `${this.thickness}px`;
      this.#eraserCursor.style.display = 'none'
      this.parent.div.appendChild(this.#eraserCursor);
      

      this.parent.div.addEventListener('pointermove', this._updateCursor);
      this.parent.div.addEventListener('pointerdown', this._pointerDown);
      this.parent.div.addEventListener('pointerup', this._pointerUp);
      this.parent.div.addEventListener('pointercancel', this._pointerUp);
      this.parent.div.addEventListener('pointerleave', this._hideCursor);

      this.#updateDivSize();

      const inkEditors = this.#getInkEditors();
      for(const inkEditor of inkEditors){
        inkEditor.updateEraseMode(true, this._defaultThickness);
      }
    }

    /** @inheritdoc */
    disableEditMode(){
      if(!this.isInEditMode()){
        return;
      }

      super.disableEditMode();
      
      const inkEditors = this.#getInkEditors();
      for(const inkEditor of inkEditors){
        inkEditor.updateEraseMode(false);
      }
      this._hideCursor();

      this.parent.div.removeEventListener('pointermove', this._updateCursor);
      this.parent.div.removeEventListener('pointerdown', this._pointerDown);
      this.parent.div.removeEventListener('pointerup', this._pointerUp);
      this.parent.div.removeEventListener('pointercancel', this._pointerUp);
      this.parent.div.removeEventListener('pointerleave', this._hideCursor);
  
      
      if(this.#eraserCursor){
        this.#eraserCursor.remove();
        this.#eraserCursor = null;
      }

      this.resetPointerType();
      this._isDraggable = false; //Always false for eraser
      this.div.classList.remove("editing");

    }
    /** @inheritdoc */
    onceAdded(){
      this.setInForeground();
      this._isDraggable = false; //Always false for eraser
    }

    /** @inheritdoc */
    isEmpty(){
      return true; // Eraser is always empty as it doesn't store annotations
    }


    /** @inheritdoc */
    render() {
      if (this.div) {
        return this.div;
      }

      super.render();

      this.div.setAttribute("data-l10n-id", "pdfjs-eraser");

      this.div.classList.add("editing");
      this.enableEditMode();

      return this.div;
    }


    #updateDivSize() {
      if(this.parent.div && this.div){
        const [parentWidth, parentHeight] = this.parentDimensions;
        if (parentWidth && parentHeight) {
          this.div.style.width = `${parentWidth}px`;
          this.div.style.height = `${parentHeight}px`;
        }
    }
  }


    #getInkEditors(){
      if(!this.parent.getEditors()){
        return [];
      }
      const allEditors = this.parent.getEditors();
      return allEditors.filter(editor => {
        return editor instanceof InkEditor
      });
    }

    _updateCursor(evt) {
      if(!this.#eraserCursor) return;

      const rect = this.parent.div.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;

      this.#eraserCursor.style.left = `${x - this.thickness/2}px`;
      this.#eraserCursor.style.top  = `${y - this.thickness/2}px`;

      if(evt.pointerType === 'mouse' || (evt.pointerType === 'pen' || this.#isPenDown)){
        this._showCursor();
      }
    }

    _showCursor(){
      if(this.#eraserCursor && this.isInEditMode()){
        this.#eraserCursor.style.display = 'block';
      }
    }
    _hideCursor(){
      if(this.#eraserCursor){
        this.#eraserCursor.style.display = 'none';
      }
    }
    _pointerDown(event){
      this.#isPenDown = true;
      if(event.pointerType === 'pen' || event.pointerType === 'mouse'){
        this._showCursor();
        this._updateCursor(event);

        if(event.PointerType === 'pen' && event.cancelable){
          event.preventDefault();
        }
      }
    }
    _pointerUp(event){
      this.#isPenDown = false;
      this._hideCursor();
    }

    /** @override */
    commitOrRemove(){
      this.commit();
    }

    commit(){
      if(this.#disableEditing){
        return;
      }
      if(this.#eraserCursor){
        this.#eraserCursor.style.display = 'none';
      }
    }
}