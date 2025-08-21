import { AnnotationEditor } from "./editor.js";
import { AnnotationEditorParamsType, AnnotationEditorType } from "../../shared/util.js";
import { InkEditor } from "./ink.js";
import { noContextMenu, stopEvent } from "../display_utils.js";

export class EraserEditor extends AnnotationEditor{

    static #currentEraserAC = null;

    static #currentPointerId = NaN;

    static #currentPointerType = null;

    static #currentPointerIds = null;

    static #currentMoveTimestamp = NaN;

    #inkEditors = [];

    static _defaultThickness = 20;

    static _type = "eraser";

    static _editorType = AnnotationEditorType.ERASER;

    constructor(params){
        super({...params, name: "eraserEditor"});
        
        this.thickness = params.thickness || EraserEditor._defaultThickness;

        this._isDraggable = false;

        this._cursor = null;
        this._updateCursor = this.#updateCursor.bind(this);
        this._showCursor = this.#showCursor.bind(this);
        this._hideCursor = this.#hideCursor.bind(this);

        this._isErasing = false;

        this._startEraseSession = this.#startEraseSession.bind(this);

    }

    /** @inheritdoc */
    static initialize(l10n, uiManager){
        AnnotationEditor.initialize(l10n, uiManager);
    }

    /** @inheritdoc */
    static updateDefaultParams(type, value){
        switch(type){
            case AnnotationEditorParamsType.ERASER_THICKNESS:
                EraserEditor._defaultThickness = value;
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

    static get defaultPropertiesToUpdate(){
        return [
            [
                AnnotationEditorParamsType.ERASER_THICKNESS,
                EraserEditor._defaultThickness,
            ],
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

             if(this._cursor){
                this._cursor.style.width = `${this.thickness}px`;
                this._cursor.style.height = `${this.thickness}px`;
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

        this.eventBus?.dispatch("annotation-editor-event", {
            source: this,
            type: "thicknessChanged",
            page: this.pageIndex + 1,
            editorType: this.constructor.name,
            value: thickness,
            previousValue: savedThickness,
        });
    }

    /** Ensures EraserEditor spans the entire AnnotationEditorLayer */
    fixAndSetPosition(){
        this.x = 0;
        this.y = 0;
        this.width = 1;
        this.height = 1;

        const [parentWidth, parentHeight] = this.parentDimensions;
        this.setDims(parentWidth, parentHeight);
        
        return super.fixAndSetPosition(0);
    }

    /** @inheritdoc */
    render(){
        if(this.div){
            return this.div;
        }

        const div = super.render();

        this.fixAndSetPosition();

        this.#inkEditors = this.#getInkEditors();

        this.enableEditing();

        return div;
    }

    /** @inheritdoc */
    enableEditing(){
        super.enableEditing();
        this.div?.classList.toggle("disabled", false);

        if(this._cursor){
            this._cursor.remove();
            this._cursor = null;
        }
        if(this.div){
            this.div.style.pointerEvents = "auto";
            this.div.style.zIndex = "1000";

            this._cursor = document.createElement('div');
            this._cursor.className = 'eraserCursor';
            this._cursor.style.width = `${this.thickness}px`;
            this._cursor.style.height = `${this.thickness}px`;
            this._cursor.style.display = 'none'
            this._cursor.style.pointerEvents = "none";
            this.div.appendChild(this._cursor);

            this.div.addEventListener('pointermove', this._updateCursor);
            this.div.addEventListener('pointerenter', this._updateCursor);
            this.div.addEventListener('pointerleave', this._hideCursor);

            this.div.addEventListener("pointerdown", this._startEraseSession);
        }
        
    }

    /** @inheritdoc */
    disableEditing(){
        super.disableEditing();
        this.div?.classList.toggle("disabled", true);

        this.#abortEraseSession();

        if(this._cursor){
            this._cursor.remove();
            this._cursor = null;
        }
        if(this.div){
            this.div.style.pointerEvents = "";
            this.div.style.zIndex = "";


            this.div.removeEventListener('pointermove', this._updateCursor);
            this.div.removeEventListener('pointerenter', this._updateCursor);
            this.div.removeEventListener('pointerleave', this._hideCursor);

            this.div.removeEventListener("pointerdown", this._startEraseSession);
        }
    }

    /** @inheritdoc */
    remove(){
        super.remove();

        this.#abortEraseSession();

        if(this._cursor){
            this._cursor.remove();
            this._cursor = null;
        }
        if(this.div){
            this.div.removeEventListener('pointermove', this._updateCursor);
            this.div.removeEventListener('pointerenter', this._updateCursor);
            this.div.removeEventListener('pointerleave', this._hideCursor);
        }
    }

    #startEraseSession(event){
        if(event.button !== 0) return;

        const {pointerId, pointerType, target} = event;
        if(EraserEditor.#currentPointerType &&
            EraserEditor.#currentPointerType !== pointerType
        ){
            return;
        }

        this.#updateCursor(event);

        const ac = (EraserEditor.#currentEraserAC = new AbortController());
        const signal = this.parent.combinedSignal(ac);

        EraserEditor.#currentPointerId ||= pointerId;
        EraserEditor.#currentPointerType ??= pointerType;

        window.addEventListener(
            "pointerup",
            e => {
                if (EraserEditor.#currentPointerId === e.pointerId) {
                    this.#endErase(e);
                } else {
                    EraserEditor.#currentPointerIds?.delete(e.pointerId);
                }
            },
            { signal }
        );
        window.addEventListener(
            "pointercancel",
            e => {
                if (EraserEditor.#currentPointerId === e.pointerId) {
                    this.#endErase(e, /* isCanceled = */ true);
                } else {
                    EraserEditor.#currentPointerIds?.delete(e.pointerId);
                }
            },
            { signal }
        );
        window.addEventListener(
            "pointerdown",
            e => {
                if (EraserEditor.#currentPointerType !== e.pointerType) {
                    return;
                }
                // Multi-pointer of same type (e.g., two fingers) -> stop erasing
                (EraserEditor.#currentPointerIds ||= new Set()).add(e.pointerId);
                if (this._isErasing) {
                    this.#endErase(null, /* isCanceled = */ true);
                }
            },
            { capture: true, passive: false, signal }
        );
        window.addEventListener("contextmenu", noContextMenu, { signal });

        target.addEventListener(
          "pointermove",
          this.#onWindowPointerMove.bind(this),
          { signal }
        );

        // Prevent touch scroll when the move is used for erasing
        target.addEventListener(
          "touchmove",
          e => {
            if (e.timeStamp === EraserEditor.#currentMoveTimestamp) {
              stopEvent(e);
            }
          },
          { signal }
        );

        this._isErasing = true;
        this.#erase(event.clientX, event.clientY);
        stopEvent(event);
    }

    
    #onWindowPointerMove(event){
        if (!this._isErasing) return;

        const { pointerId } = event;

        if (EraserEditor.#currentPointerId !== pointerId) {
          return;
        }
        if (EraserEditor.#currentPointerIds?.size >= 1) {
          // Multi-pointer gesture started: stop erasing
          this.#endErase(event, /* isCanceled = */ true);
          return;
        }

        this.#erase(event.clientX, event.clientY);
        EraserEditor.#currentMoveTimestamp = event.timeStamp;
        stopEvent(event);
    }

    #endErase(event, isCanceled = false){
        this.#abortEraseSession();
    }

    #abortEraseSession(){
        if (EraserEditor.#currentEraserAC) {
            EraserEditor.#currentEraserAC.abort();
            EraserEditor.#currentEraserAC = null;
        }
        EraserEditor.#currentPointerId = NaN;
        EraserEditor.#currentPointerIds = null;
        EraserEditor.#currentPointerType = null;
        EraserEditor.#currentMoveTimestamp = NaN;
        this._isErasing = false;
    }

    isEmpty(){
        return true;
    }

    #updateCursor(event){
        if(!this._cursor) return ;

        const rect = this.parent.div.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        this._cursor.style.left = `${x - this.thickness/2}px`;
        this._cursor.style.top  = `${y - this.thickness/2}px`;

        this.#showCursor();
    }

    #showCursor(){
        this._cursor.style.display = 'block';
    }

    #hideCursor(){
        this._cursor.style.display = 'none';
    }

    #getInkEditors(){
        const editors = this._uiManager.getEditors(this.pageIndex) || [];
        return editors.filter(ed => ed.editorType === "ink" && ed?.parent?.div && ed?.div);
    }

    // #onPointerDown(event){
    //     if (event.button !== 0) return;
    //     this._isErasing = true;
    //     this.#erase(event.clientX, event.clientY);
    // }

    // #onPointerMove(event){
    //     if (!this._isErasing) return;
    //     this.#erase(event.clientX, event.clientY);
    // }

    // #onPointerUp(event){
    //     this._isErasing = false;
    // }
    

    #erase(clientX, clientY) {

        const layerRect = this.parent.div.getBoundingClientRect();
        const x = clientX - layerRect.left;
        const y = clientY - layerRect.top;
        const radius = this.thickness / 2;
        const radius2 = radius * radius;

        for (const editor of this.#inkEditors) {
            let modified = false;
            if(!editor?.parent?.div || !editor?.div) continue;

            const pdfRect = editor.getRect(0, 0, editor.rotation);
            const [pageWidth, pageHeight] = editor.pageDimensions;
            const [pageX, pageY] = editor.pageTranslation;
            const [cx, cy, cw, ch] = editor.getRectInCurrentCoords(pdfRect, pageHeight);
            const scale = editor.parentScale;
            const left = (cx - pageX) * scale;
            const top  = (cy + pageY) * scale;
            const right = left + cw * scale;
            const bottom = top + ch * scale;
            if (!this.#hitBBox(x, y, radius, [left, top, right, bottom])) continue;

            const { points } = editor.serializeDraw(false);

            const newPaths = [];

            for(const path of points){
                if(path.length === 0) continue;
                let newPath = [];
                for(let i = 0; i < path.length; i+=2){
                    const [lx, ly] = this.#pagePointToLayer(path[i], path[i+1], editor);
                    const dx = lx - x;
                    const dy = ly - y;
                    const dist = dx * dx + dy * dy;
                    if(dist >= radius2){
                        newPath.push(path[i]);
                        newPath.push(path[i+1]);
                    }
                    else{
                        modified = true;
                        if(newPath.length > 3){
                            newPaths.push(new Float32Array(newPath));
                        }
                        newPath = [];
                    }
                }
                if(newPath.length > 3){
                    newPaths.push(new Float32Array(newPath));
                }
            }
            if(modified){
                this.#replaceInkEditorPaths(editor, newPaths);
            }
        }
    }

    #replaceInkEditorPaths(editor, newPaths){
        if(!newPaths || newPaths.length === 0){
            editor.remove();
            return;
        }

        const {
          viewport: {
            rawDims: { pageWidth, pageHeight, pageX, pageY },
          },
        } = editor.parent;

        const thickness = editor._drawingOptions["stroke-width"];
        const rotation = editor.rotation;

        const newOutlines = InkEditor.deserializeDraw(
          pageX,
          pageY,
          pageWidth,
          pageHeight,
          InkEditor._INNER_MARGIN,
          {
            paths: { points: newPaths },
            rotation,
            thickness,
          }
        );

        editor.replaceOutlines(newOutlines);
        editor.onScaleChanging();
    }


    #hitBBox(x, y, r, rect) {
        const [left, top, right, bottom] = rect;
        const cx = Math.max(left, Math.min(x, right));
        const cy = Math.max(top, Math.min(y, bottom));
        const dx = x - cx;
        const dy = y - cy;
        return dx * dx + dy * dy <= r * r;
    }


  #pagePointToLayer(px, py, editor) {
    const [pageX, pageY] = editor.pageTranslation;
    const [pageW, pageH] = editor.pageDimensions;
    const { width: layerW, height: layerH } =
      editor.parent.div.getBoundingClientRect();

    let nx = (px - pageX) / pageW;
    let ny = (py - pageY) / pageH;

    let rx, ry;
    switch ((editor.rotation || 0) % 360) {
      case 90:
        rx = ny;
        ry = 1 - nx;
        break;
      case 180:
        rx = 1 - nx;
        ry = 1 - ny;
        break;
      case 270:
        rx = 1 - ny;
        ry = nx;
        break;
      default:
        rx = nx;
        ry = ny;
        break;
    }

    const lx = rx * layerW;
    const ly = (1 - ry) * layerH;
    return [lx, ly];
  }


}