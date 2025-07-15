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

    #observer = null;

    #disableEditing = false;

    #boundCanvasPointerdown = this.canvasPointerdown.bind(this);

    #boundCanvasPointermove = this.canvasPointermove.bind(this);

    #boundCanvasPointerLeave = this.canvasPointerLeave.bind(this);

    #boundCanvasPointerup = this.canvasPointerup.bind(this);

    #boundCanvasTouchMove = this.canvasTouchMove.bind(this);

    static _defaultThickness = 20;

    static _type = "eraser";

    static _editorType = AnnotationEditorType.ERASER;

    constructor(params){
        super({ ...params, name: "eraserEditor" });
        
        this.thickness = params.thickness || null;
        
        this.radius = this.thickness / 2;
        
        this.editorPointerType = null;

        this._updateCursor = this._updateCursor.bind(this);
    }

    destroy() {
      super.destroy();

      if(this._eraserCursor){
        this._eraserCursor.remove();
        this._eraserCursor = null;
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
          this.#updateThickness(value);
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

    #updateThickness(thickness){
      const setThickness = th => {
        this.thickness = th;
        this.radius = th / 2;

        if(this._eraserCursor){
        this._eraserCursor.style.width = `${th}px`;
        this._eraserCursor.style.height = `${th}px`;
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
    // #2256 modified by ngx-extended-pdf-viewer
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

      if(!this.canvas){
        this.#createCanvas();
        this.#createObserver();
      } else {
        // Update canvas size if it already exists
        this.#updateCanvasSize();
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
      if(this._eraserCursor){
        this._eraserCursor.remove();
        this._eraserCursor = null;
      }
      
      if(this.canvas === null){
        return;
      }

      if(this.canvas){
        this.canvas.removeEventListener("pointermove", this._updateCursor);
        this.canvas.removeEventListener('pointerenter', this._showCursor.bind(this));
        this.canvas.removeEventListener('pointerleave', this._hideCursor.bind(this));
        this.canvas.style.cursor = '';
      }

      this.commit();

      this.canvas.width = this.canvas.height = 0;
      this.canvas.remove();
      this.canvas = null;

      this.#observer?.disconnect();
      this.#observer = null;

      super.remove();
    }

    /** @inheritdoc */
    enableEditMode(){
      if(this.#disableEditing || this.canvas === null){
        return;
      }

      super.enableEditMode();

      // this.canvas.style.cursor = 'none';

      this._eraserCursor = document.createElement('div');
      this._eraserCursor.className = 'eraserCursor';
      this._eraserCursor.style.display = 'block';
      this._eraserCursor.style.width = `${this.radius * 2}px`;
      this._eraserCursor.style.height = `${this.radius * 2}px`;
      document.body.appendChild(this._eraserCursor);

      document.addEventListener('pointermove', this._updateCursor);
      this.parent.div.addEventListener('pointerenter', this._showCursor);
      this.parent.div.addEventListener('pointerleave', this._hideCursor);

      const inkEditors = this.#getInkEditors();
      for(const inkEditor of inkEditors){
        inkEditor.updateEraseMode(true);
      }
    }

    /** @inheritdoc */
    disableEditMode(){
      if(!this.isInEditMode() || this.canvas === null){
        return;
      }

      super.disableEditMode();
      
      const inkEditors = this.#getInkEditors();
      for(const inkEditor of inkEditors){
        inkEditor.updateEraseMode(false);
      }
      this._hideCursor();

      this.canvas.style.cursor = '';
      document.removeEventListener('pointermove', this._updateCursor);
      this.canvas.removeEventListener('pointerenter', this._showCursor.bind(this));
      this.canvas.removeEventListener('pointerleave', this._hideCursor.bind(this));
      
      if(this._eraserCursor){
        this._eraserCursor.remove();
        this._eraserCursor = null;
      }

      this.resetPointerType();
      this._isDraggable = false; //Always false for eraser
      this.div.classList.remove("editing");

      this.canvas.removeEventListener(
        "pointerdown",
        this.#boundCanvasPointerdown
      );
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

    // #startErasing(x, y){
    //   const signal = this._uiManager._signal;
    //   this.canvas.addEventListener("contextmenu", noContextMenu, { signal });
    //   this.canvas.addEventListener("pointerleave", this.#boundCanvasPointerLeave, { signal });
    //   this.canvas.addEventListener("pointermove", this.#boundCanvasPointermove, { signal });
    //   this.canvas.addEventListener("pointerup", this.#boundCanvasPointerup, { signal });
    //   this.canvas.addEventListener("touchmove", this.#boundCanvasTouchMove, {
    //     signal: this._uiManager._signal,
    //     passive: false,
    //   });
    //   this.canvas.removeEventListener("pointerdown", this.#boundCanvasPointerdown);

    //   this.isEditing = true;

    //   this.#erase(x,y);
    // }

    // #erase(x, y){
    //   const inkEditors = this.#getInkEditors();
    //   for(const inkEditor of inkEditors){
    //     if(this.#checkInkBoxCollision(inkEditor, x, y)){
    //       inkEditor.erase(x, y, this.radius);
    //     }
    //   }
    // }

    // #endErasing(event){
    //   this.canvas.removeEventListener("pointerleave", this.#boundCanvasPointerLeave);
    //   this.canvas.removeEventListener("pointermove", this.#boundCanvasPointermove);
    //   this.canvas.removeEventListener("pointerup", this.#boundCanvasPointerup);
    //   this.canvas.removeEventListener("touchmove", this.#boundCanvasTouchMove);
    //   this.canvas.addEventListener("pointerdown", this.#boundCanvasPointerdown, { signal: this._uiManager._signal });

    //   this.isEditing = false;
      
    //   this.canvas.removeEventListener("contextmenu", noContextMenu);
    // }


    /** @inheritdoc */
    render() {
      if (this.div) {
        return this.div;
      }

      super.render();

      this.div.setAttribute("data-l10n-id", "pdfjs-eraser");

      this.#createCanvas();
      this.#createObserver();

      // Eraser always covers the full page and is in editing mode
      this.div.classList.add("editing");
      this.enableEditMode();

      return this.div;
    }

    #createCanvas(){
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.canvas.height = 0;
      this.canvas.className = "eraserEditorCanvas";
      this.canvas.setAttribute("data-l10n-id", "pdfjs-eraser-canvas");
      this.div.append(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      
      // Set initial canvas size to match div
      this.#updateCanvasSize();
    }

    #updateCanvasSize() {
      if (this.canvas && this.div) {
        const rect = this.div.getBoundingClientRect();
        if (rect.width && rect.height) {
          this.canvas.width = Math.round(rect.width);
          this.canvas.height = Math.round(rect.height);
        }
      }
    }

    
  #createObserver() {
    this.#observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width && rect.height && this.canvas) {
        this.canvas.width = Math.round(rect.width);
        this.canvas.height = Math.round(rect.height);
      }
    });
    this.#observer.observe(this.div);
    this._uiManager._signal.addEventListener(
      "abort",
      () => {
        this.#observer?.disconnect();
        this.#observer = null;
      },
      { once: true }
    );
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
      if(!this._eraserCursor) return;

      const rect = this.canvas.getBoundingClientRect();
      // const x = rect.left + evt.offsetX;
      // const y = rect.top  + evt.offsetY;
      const x = evt.clientX;
      const y = evt.clientY;

      this._eraserCursor.style.display = 'block';
      this._eraserCursor.style.left = `${x - this.thickness/2}px`;
      this._eraserCursor.style.top  = `${y - this.thickness/2}px`;
    }

    _showCursor(){
      if(this._eraserCursor && this.isInEditMode()){
        this._eraserCursor.style.display = 'block';
      }
    }
    _hideCursor(){
      if(this._eraserCursor){
        this._eraserCursor.style.display = 'none';
      }
    }
    /** @override */
    commitOrRemove(){
      this.commit();
    }
    
    /**
     * onpointerdown callback for the canvas we're erasing on.
     * @param {PointerEvent} event
     */
    canvasPointerdown(event){
      if (event.button !== 0 || !this.isInEditMode() || this.#disableEditing || this.editorPointerType !== PointerType.current){
        return;
      }
      event.preventDefault();

      if(!this.div.contains(document.activeElement)){
        this.div.focus({
          preventScroll: true,
        })
      }
      // this.#startErasing(event.offsetX, event.offsetY);
    }

    /**
     * onpointerleave callback for the canvas we're erasing on.
     * @param {PointerEvent} event
     */
    canvasPointerLeave(event){
      if (event.target == document.documentElement || event.relatedTarget === null){
        // this.#endErasing(event);
      }
    }

    /**
     * onpointermove callback for the canvas we're erasing on.
     * @param {PointerEvent} event
     */
    canvasPointermove(event) {
      event.preventDefault();

      // this.#erase(event.offsetX, event.offsetY);
    }

    /**
     * onpointerup callback for the canvas we're erasing on.
     * @param {PointerEvent} event
     */
    canvasPointerup(event) {
      event.preventDefault();
      
      // this.#endErasing(event);
    }
  
    canvasTouchMove(event) {
      if (!this.isInEditMode() || this.#disableEditing || this.editorPointerType !== PointerType.current) {
        return;
      }
      // disable default scroll behaviour on touch move
      event.preventDefault();
    }

    commit(){
      if(this.#disableEditing){
        return;
      }
      if(this._eraserCursor){
        this._eraserCursor.style.display = 'none';
      }
    }
}