import { AnnotationEditor } from "./editor.js";
import { AnnotationEditorType } from "../../shared/util.js";
import { noContextMenu } from "../display_utils.js";

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

    static _defaultThickness = 10;

    static _type = "eraser";

    static _editorType = AnnotationEditorType.ERASER;

    constructor(params){
        super({ ...params, name: "eraserEditor" });
        
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

    onScaleChanging() {
      // Update canvas dimensions when scale changes
      this.#updateCanvasSize();
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

      this.canvas.style.cursor = 'none';

      if (!this._eraserCursor) {
        this._eraserCursor = document.createElement('div');
        this._eraserCursor.className = 'eraserCursor';

        document.body.appendChild(this._eraserCursor);
      }

      this.canvas.addEventListener('pointermove', this._updateCursor);
      this.canvas.addEventListener('pointerenter', this._showCursor.bind(this));
      this.canvas.addEventListener('pointerleave', this._hideCursor.bind(this));

      setTimeout(() => this.initializePointerType(), 0);
      this._isDraggable = false; // Always false for eraser
      this.canvas.addEventListener('pointerdown', this.#boundCanvasPointerdown, {
        signal: this._uiManager._signal,
      });
    }

    /** @inheritdoc */
    disableEditMode(){
      if(!this.isInEditMode() || this.canvas === null){
        return;
      }

      super.disableEditMode();

      this._hideCursor();

      this.canvas.style.cursor = '';
      this.canvas.removeEventListener('pointermove', this._updateCursor);
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

    #getInitialBBox(){
      const {
        parentRotation,
        parentDimensions: [width, height],
      } = this;
      switch(parentRotation){
        case 90:
          return [0, height, height, width];
        case 180:
          return [width, height, width, height];
        case 270:
          return [width, 0, height, width];
        default:
          return [0, 0, width, height];
      }
    }

    #startErasing(x, y){
      console.log("startErasing");
      const signal = this._uiManager._signal;
      this.canvas.addEventListener("contextmenu", noContextMenu, { signal });
      this.canvas.addEventListener("pointerleave", this.#boundCanvasPointerLeave, { signal });
      this.canvas.addEventListener("pointermove", this.#boundCanvasPointermove, { signal });
      this.canvas.addEventListener("pointerup", this.#boundCanvasPointerup, { signal });
      this.canvas.addEventListener("touchmove", this.#boundCanvasTouchMove, {
        signal: this._uiManager._signal,
        passive: false,
      });
      this.canvas.removeEventListener("pointerdown", this.#boundCanvasPointerdown);

      this.isEditing = true;

      // TODO: Implement erasing logic
    }

    #erase(x, y){
      console.log("Erase");
      // TODO: Implement actual erasing logic
    }

    #endErasing(event){
      console.log("endErasing");
      this.canvas.removeEventListener("pointerleave", this.#boundCanvasPointerLeave);
      this.canvas.removeEventListener("pointermove", this.#boundCanvasPointermove);
      this.canvas.removeEventListener("pointerup", this.#boundCanvasPointerup);
      this.canvas.removeEventListener("touchmove", this.#boundCanvasTouchMove);
      this.canvas.addEventListener("pointerdown", this.#boundCanvasPointerdown, { signal: this._uiManager._signal });

      this.isEditing = false;
      // TODO: Complete erasing logic
    }


    /** @inheritdoc */
    render() {
      if (this.div) {
        return this.div;
      }

      super.render();

      this.div.setAttribute("data-l10n-id", "pdfjs-eraser");

      // Eraser covers the full page
      const [x, y, w, h] = this.#getInitialBBox();
      this.setAt(x, y, 0, 0);
      this.setDims(w, h);

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
      
      if (this.div) {
        this.#observer.observe(this.div);
      }
      
      if (this._uiManager && this._uiManager._signal) {
        this._uiManager._signal.addEventListener(
          "abort",
          () => {
            this.#observer?.disconnect();
            this.#observer = null;
          },
          { once: true }
        );
      }
    }

    // called on every pointermove while eraser is active
    _updateCursor(evt) {
      if(!this._eraserCursor) return;

      const rect = this.canvas.getBoundingClientRect();
      const x = rect.left + evt.offsetX;
      const y = rect.top  + evt.offsetY;

      this._eraserCursor.style.display = 'block';
      this._eraserCursor.style.left = `${x}px`;
      this._eraserCursor.style.top  = `${y}px`;
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

      this.#startErasing(event.offsetX, event.offsetY)
    }

    /**
     * onpointerleave callback for the canvas we're erasing on.
     * @param {PointerEvent} event
     */
    canvasPointerLeave(event){
      if (event.target == document.documentElement || event.relatedTarget === null){
        this.#endErasing(event);
      }
    }

    /**
     * onpointermove callback for the canvas we're erasing on.
     * @param {PointerEvent} event
     */
    canvasPointermove(event) {
      event.preventDefault();

      this.#erase(event.offsetX, event.offsetY);
    }

    /**
     * onpointerup callback for the canvas we're erasing on.
     * @param {PointerEvent} event
     */
    canvasPointerup(event) {
      event.preventDefault();
      
      this.#endErasing(event);
    }
  
    canvasTouchMove(event) {
      if (!this.isInEditMode() || this.#disableEditing || this.editorPointerType !== PointerType.current) {
        return;
      }
      // disable default scroll behaviour on touch move
      event.preventDefault();
    }


    // TODO

    commit(){
      if(this.#disableEditing){
        return;
      }
      if(this._eraserCursor){
        this._eraserCursor.style.display = 'none';
      }
    }
}