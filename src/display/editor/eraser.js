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


    #baseHeight = 0;

    #baseWidth = 0;

    #observer = null;

    #disableEditing = false;

    #boundCanvasPointerdown = this.canvasPointerdown.bind(this);

    #boundCanvasPointermove = this.canvasPointermove.bind(this);

    #boundCanvasPointerLeave = this.canvasPointerLeave.bind(this);

    #boundCanvasPointerup = this.canvasPointerup.bind(this);

    #boundCanvasTouchMove = this.canvasTouchMove.bind(this);

    #isErasing = false;

    #eraserPath = [];

    #isCanvasInitialized = false;

    #realWidth = 0;

    #realHeight = 0;

    static _defaultThickness = 10;

    static _type = "eraser";

    static _editorType = AnnotationEditorType.ERASER;

    constructor(params){
        super({ ...params, name: "eraserEditor" });
        
        this.editorPointerType = null;

        this._updateCursor = this._updateCursor.bind(this);
    }

    destroy() {
      console.log("Destroy called")
      super.destroy();

      if(this._eraserCursor){
        this._eraserCursor.remove();
        this._eraserCursor = null;
      }

      if (EraserEditor._currentPointerType !== null) {
        window.removeEventListener("pointerdown", this.windowPointerDown);
        InkEditor._currentPointerType = null;  // remove listener only once
      }
    }

    initializePointerType(){
      this.editorPointerType = PointerType.current;
    }

    resetPointerType(){
      this.editorPointerType = null;
    }

    /** @inheritdoc */
    rebuild(){
      console.log("rebuild called")
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
      }
      if(!this.isAttachedToDOM){
        this.parent.add(this);
        this.#setCanvasDims();
      }
      // this.#fitToContent();
    }

    /** @inheritdoc */
    remove(){
      console.log("remove called")
      if(this.canvas === null){
        return;
      }

      if(this._eraserCursor){
        this._eraserCursor.remove();
        this._eraserCursor = null;
      }

      if(this.canvas){
        this.canvas.removeEventListener("pointermove", this._updateCursor);
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

    setParent(parent) {
      console.log("setParent called")
      if (!this.parent && parent) {
        if(this._eraserCursor){
          this._eraserCursor.remove();
          this._eraserCursor = null;
        }
        this._uiManager.removeShouldRescale(this);
      } else if (this.parent && parent === null) {
        this._uiManager.addShouldRescale(this);
      }
      super.setParent(parent);
    }

    onScaleChanging(){
      console.log("onScaleChaning called")
      const [parentWidth, parentHeight] = this.parent;
      const width = this.width * parentWidth;
      const height = this.height * parentHeight;
      this.setDimensions(width, height);
    }

    /** @inheritdoc */
    enableEditMode(){
      console.log("Enable Edit mode called");

      if(this.#disableEditing || this.canvas === null){
        return;
      }

      super.enableEditMode();

      this.canvas.style.cursor = 'none';

      if (!this._eraserCursor) {
        this._eraserCursor = document.createElement('div');
        Object.assign(this._eraserCursor.style, {
          position: 'absolute',
          width:  `${EraserEditor._defaultThickness}px`,
          height: `${EraserEditor._defaultThickness}px`,
          border: '2px solid rgba(0,0,0,0.5)',
          borderRadius: '50%',
          pointerEvents: 'none',
          transform: 'translate(-50%,-50%)',
          zIndex: '1000'
        });
        document.body.appendChild(this._eraserCursor);
      }

      this.canvas.addEventListener('pointermove', this._updateCursor);

      setTimeout(() => this.initializePointerType());
      this._isDraggable = false; // Always false for eraser
      this.canvas.addEventListener('pointerdown', this.#boundCanvasPointerdown, {
        signal: this._uiManager._signal,
      });

      console.log("Entire edit mode body called");
    }

    /** @inheritdoc */
    disableEditMode(){
      console.log("Disable edit mode called");
      if(!this.isInEditMode() || this.canvas === null){
        return;
      }

      super.disableEditMode();

      this.canvas.style.cursor = '';
      this.canvas.removeEventListener('pointermove', this._updateCursor);
      
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

      console.log("Entire disable edit mode called");
    }
    /** @inheritdoc */
    onceAdded(){
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
      console.log("Start Erasing Called");

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


      // TODO Complete
    }

    #erase(x, y){
      // TODO
      console.log("Erase Called");
    }

    #endErasing(event){
      console.log("End Erasing called");

      this.canvas.removeEventListener("pointerleave", this.#boundCanvasPointerLeave);
      this.canvas.removeEventListener("pointermove", this.#boundCanvasPointermove);
      this.canvas.removeEventListener("pointerup", this.#boundCanvasPointerup);
      this.canvas.removeEventListener("touchmove", this.#boundCanvasTouchMove);
      this.canvas.addEventListener("pointerdown", this.#boundCanvasPointerdown, { signal: this._uiManager._signal });

      // TODO complete

    }


    /** @inheritdoc */
    render() {
      console.log("Render called");
      if (this.div) {
        return this.div;
      }

      let baseX, baseY;
      if (this.width) {
        baseX = this.x;
        baseY = this.y;
      }

      super.render();

      this.div.setAttribute("data-l10n-id", "pdfjs-eraser");

      const [x, y, w, h] = this.#getInitialBBox();
      this.setAt(x, y, 0, 0);
      this.setDims(w, h);

      this.#createCanvas();

      if (this.width) {
        const [parentWidth, parentHeight] = this.parentDimensions;
        this.setAspectRatio(this.width * parentWidth, this.height * parentHeight);
        this.setAt(
          baseX * parentWidth,
          baseY * parentHeight,
          this.width * parentWidth,
          this.height * parentHeight
        );

        this.#isCanvasInitialized = true;
        this.#setCanvasDims();
        this.setDims(this.width * parentWidth, this.height * parentHeight);
        this.#redraw();
        this.div.classList.add("disabled");
      } else {
        this.div.classList.add("editing");
        this.enableEditMode();
      }

      this.#createObserver();

      return this.div;
    }

    #setCanvasDims() {
      console.log("SetCanvasDims called");
      if (!this.#isCanvasInitialized) {
        console.log("setCanvasDims exited early");
        return;
      }
      const [parentWidth, parentHeight] = this.parentDimensions;
      this.canvas.width = Math.ceil(this.width * parentWidth);
      this.canvas.height = Math.ceil(this.height * parentHeight);
      this.#updateTransform();
    }

    setDimensions(width, height){
      console.log("setDimensions called");
      const roundedWidth = Math.round(width);
      const roundedHeight = Math.round(height);
      
      if (this.#realWidth === roundedWidth && this.#realHeight === roundedHeight) {
        return;
      }

      this.#realWidth = roundedWidth;
      this.#realHeight = roundedHeight;

      this.canvas.width = roundedWidth;
      this.canvas.height = roundedHeight;
      this.#updateTransform();
    }

    #redraw() {
      console.log("#redraw called");
      if (this.isEmpty()) {
        this.#updateTransform();
        return;
      }

      const { canvas, ctx } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.#updateTransform();

      for (const path of this.bezierPath2D) {
        ctx.stroke(path);
      }
    }

    #updateTransform() {
      console.log("#updateTransform called");
      const padding = this.#getPadding() / 2;
      this.ctx.setTransform(
        this.scaleFactor,
        0,
        0,
        this.scaleFactor,
        this.translationX * this.scaleFactor + padding,
        this.translationY * this.scaleFactor + padding
      );
    }

    #getPadding() {
      console.log("#getPadding called");
      return this.#disableEditing
        ? Math.ceil(this.thickness * this.parentScale)
        : 0;
    }

    #createCanvas(){
      console.log("#createCanvas called");
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.canvas.height = 0;
      this.canvas.className = "eraserEditorCanvas";
      this.canvas.setAttribute("data-l10n-id", "pdfjs-eraser-canvas");

      this.div.append(this.canvas);
      this.ctx = this.canvas.getContext("2d");
    }

    #createObserver() {
      console.log("#createObserver called");
      this.#observer = new ResizeObserver(entries => {
        const rect = entries[0].contentRect;
        if (rect.width && rect.height) {
          this.setDimensions(rect.width, rect.height);
        }
      });
      
      if (this.div) {
        this.#observer.observe(this.div);
      }
      
      // Check if _uiManager and _signal exist before using them
      if (this._uiManager && this._uiManager._signal) {
        this._uiManager._signal.addEventListener(
          "abort",
          () => {
            if(this._eraserCursor){
              this._eraserCursor.remove();
              this._eraserCursor = null;
            }

            this.#observer?.disconnect();
            this.#observer = null;
          },
          { once: true }
        );
      } else {
        // Fallback cleanup mechanism - if _signal isn't available
        // Make sure we have a way to clean up the observer
        this._destroyObserver = () => {
          this.#observer?.disconnect();
          this.#observer = null;
        };
      }
    }

    // called on every pointermove while eraser is active
    _updateCursor(evt) {
      if(!this._eraserCursor) return;

      const rect = this.canvas.getBoundingClientRect();
      const x = rect.left + evt.offsetX;
      const y = rect.top  + evt.offsetY;
      this._eraserCursor.style.left = `${x}px`;
      this._eraserCursor.style.top  = `${y}px`;
    }
    
    /**
     * onpointerdown callback for the canvas we're erasing on.
     * @param {PointerEvent} event
     */
    canvasPointerdown(event){
      if (event.button !== 0 || !this.isInEditMode() || this.#disableEditing || this.editorPointerType !== PointerType.current){
        return;
      }
      // this.setInForeground() (Implement)
      event.preventDefault();

      if(!this.div.contains(document.activeElement)){
        this.div.focus({
          preventScroll: true,
        })
      }

      this.#startErasing(event.offsetX, event.offsetY)
    }

    /**
     * onpointerleave callback for the canvas we're drawing on.
     * @param {PointerEvent} event
     */
    canvasPointerLeave(event){
      this.#endErasing(event);
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
      
      this.isEditing = false;
      this.disableEditMode();
    }
}