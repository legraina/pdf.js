import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
} from "../../shared/util.js";
import { noContextMenu, stopEvent } from "../display_utils.js";
import { AnnotationEditor } from "./editor.js";

class EraserEditor extends AnnotationEditor {
  // One EraserEditor is created per visible page, so these controllers must
  // be per instance: a shared static one would abort the listeners of
  // whichever page was enabled last.
  #cursorAC = null;

  #eraserAC = null;

  #cursor = null;

  // Thickness the cursor element was last sized for.
  #cursorThickness = 0;

  #isErasing = false;

  // Erase session state (only meaningful while #isErasing is true).
  #layerRect = null;

  #sessionEditors = [];

  #pendingSamples = [];

  #lastSample = null;

  #rafId = null;

  static _defaultThickness = 20;

  static _thickness;

  static _type = "eraser";

  static _editorType = AnnotationEditorType.ERASER;

  constructor(params) {
    super({ ...params, name: "eraserEditor" });
    this.defaultL10nId = "pdfjs-editor-eraser-editor";
    EraserEditor._thickness =
      params.thickness ||
      EraserEditor._thickness ||
      EraserEditor._defaultThickness;
  }

  /** @inheritdoc */
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
  }

  /** @inheritdoc */
  static updateDefaultParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.ERASER_THICKNESS:
        EraserEditor._defaultThickness = value;
        EraserEditor._thickness = value;
        break;
    }
  }

  /** @inheritdoc */
  updateParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.ERASER_THICKNESS:
        this.updateThickness(value);
        break;
    }
  }

  static get defaultPropertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.ERASER_THICKNESS,
        EraserEditor._defaultThickness,
      ],
    ];
  }

  /** @inheritdoc */
  get propertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.ERASER_THICKNESS,
        EraserEditor._thickness || EraserEditor._defaultThickness,
      ],
    ];
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    const div = super.render();
    this.fixAndSetPosition();
    this.enableEditing();
    return div;
  }

  /** Ensures EraserEditor spans the entire AnnotationEditorLayer */
  fixAndSetPosition() {
    this.x = 0;
    this.y = 0;
    this.width = 1;
    this.height = 1;

    this.setDims();

    return super.fixAndSetPosition(0);
  }

  /** @inheritdoc */
  enableEditing() {
    super.enableEditing();
    this.div?.classList.toggle("disabled", false);

    this.#abortCursor();

    if (this.div) {
      this.div.style.pointerEvents = "auto";
      this.div.style.zIndex = "1000";

      this.#cursor = document.createElement("div");
      this.#cursor.className = "eraserCursor";
      this.#cursorThickness = 0;
      this.#updateCursor();
      this.#cursor.style.display = "none";
      this.div.append(this.#cursor);

      const ac = (this.#cursorAC = new AbortController());
      const signal = this.parent.combinedSignal(ac);

      this.div.addEventListener("pointermove", this.#moveCursor.bind(this), {
        signal,
      });
      this.div.addEventListener(
        "pointerenter",
        this.#displayCursor.bind(this),
        { signal }
      );
      this.div.addEventListener("pointerleave", this.#hideCursor.bind(this), {
        signal,
      });
      this.div.addEventListener(
        "pointerdown",
        this.#startEraseSession.bind(this),
        { signal }
      );
    }
  }

  /** @inheritdoc */
  disableEditing() {
    super.disableEditing();
    this.div?.classList.toggle("disabled", true);

    this.#cancelEraseSession();
    this.#abortCursor();
  }

  /** @inheritdoc */
  remove() {
    // Commit a running session while this.parent is still available.
    this.#cancelEraseSession();
    this.#abortCursor();

    super.remove();
  }

  updateThickness(thickness) {
    const setThickness = th => {
      EraserEditor._thickness = th;
      this.#updateCursor();
    };

    const savedThickness = EraserEditor._thickness;

    this.addCommands({
      cmd: setThickness.bind(this, thickness),
      undo: setThickness.bind(this, savedThickness),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.ERASER_THICKNESS,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  isEmpty() {
    return true;
  }

  /**
   * @inheritdoc
   * The eraser spans the whole page and must never be selected or dragged:
   * selecting it renders an edit toolbar on top of it which then swallows
   * the next pointerdown, preventing any further erase session. Erasing is
   * handled by the dedicated pointerdown listener (see enableEditing).
   */
  pointerdown(_event) {}

  #startEraseSession(event) {
    if (event.button && event.button !== 0) {
      return;
    }

    const { pointerId, pointerType, target } = event;
    const currentPointers = this._uiManager.currentPointers;
    if (currentPointers.isInitializedAndDifferentPointerType(pointerType)) {
      this.#moveCursor(event);
      return;
    }

    // A session that never reached pointerup would leave its listeners
    // installed; abort it before starting a new one.
    this.#abortEraseSession();
    currentPointers.setPointer(pointerType, pointerId);

    // Everything is constant during a session (the page doesn't move while
    // erasing), so read the layout once and let the editors snapshot their
    // geometry once instead of doing it on every pointer move.
    this.#layerRect = this.parent.div.getBoundingClientRect();
    this.#moveCursor(event);
    this.#sessionEditors = [];
    for (const editor of this.#getErasableEditors()) {
      const bbox = editor.startErase(this.#layerRect);
      if (bbox) {
        this.#sessionEditors.push({ editor, bbox });
      }
    }

    const ac = (this.#eraserAC = new AbortController());
    const signal = this.parent.combinedSignal(ac);

    window.addEventListener(
      "pointerup",
      e => {
        if (currentPointers.isSamePointerIdOrRemove(e.pointerId)) {
          this.#endErase(e);
        }
      },
      { signal }
    );

    window.addEventListener(
      "pointercancel",
      e => {
        if (currentPointers.isSamePointerIdOrRemove(e.pointerId)) {
          this.#endErase(e);
        }
      },
      { signal }
    );

    window.addEventListener(
      "pointerdown",
      e => {
        if (!currentPointers.isSamePointerType(pointerType)) {
          return;
        }

        // Multi-pointer of same type (e.g., two fingers) -> stop erasing
        currentPointers.initializeAndAddPointerId(e.pointerId);
        if (this.#isErasing) {
          this.#endErase(null);
        }
      },
      { capture: true, passive: false, signal }
    );

    window.addEventListener("contextmenu", noContextMenu, { signal });

    target.addEventListener("pointermove", this.#onPointerMove.bind(this), {
      signal,
    });

    // Prevent touch scroll when the move is used for erasing
    target.addEventListener(
      "touchmove",
      e => {
        if (currentPointers.isSameTimeStamp(e.timeStamp)) {
          stopEvent(e);
        }
      },
      { signal }
    );

    this.#isErasing = true;
    this.#queueSample(event.clientX, event.clientY);
    stopEvent(event);
  }

  #onPointerMove(event) {
    const currentPointers = this._uiManager.currentPointers;
    currentPointers.clearTimeStamp();

    if (!this.#isErasing) {
      return;
    }

    const { pointerId } = event;

    if (!currentPointers.isSamePointerId(pointerId)) {
      return;
    }
    if (currentPointers.isUsingMultiplePointers()) {
      // The user is using multiple fingers and the first one is moving.
      this.#endErase(event);
      return;
    }

    this.#queueSample(event.clientX, event.clientY);

    // We track the timestamp to know if the touchmove event is used to draw.
    currentPointers.setTimeStamp(event.timeStamp);

    stopEvent(event);
  }

  #endErase(event) {
    if (event) {
      this.#queueSample(event.clientX, event.clientY);
    }
    this.#flushSamples();
    this.#commit();
    this.#abortEraseSession();
  }

  /**
   * Queue a pointer position. Pointer events can fire several times per
   * frame; the hit tests and the (expensive) path rebuilds are done once per
   * frame in #flushSamples.
   */
  #queueSample(clientX, clientY) {
    this.#pendingSamples.push(
      clientX - this.#layerRect.left,
      clientY - this.#layerRect.top
    );
    this.#rafId ??= window.requestAnimationFrame(() => {
      this.#rafId = null;
      this.#flushSamples();
    });
  }

  #flushSamples() {
    if (this.#rafId !== null) {
      window.cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    const samples = this.#pendingSamples;
    if (samples.length === 0) {
      return;
    }
    this.#pendingSamples = [];

    const radius = EraserEditor._thickness / 2;
    let [prevX, prevY] = this.#lastSample ?? [samples[0], samples[1]];
    for (let i = 0, ii = samples.length; i < ii; i += 2) {
      const x = samples[i];
      const y = samples[i + 1];
      // Bounding box of the area swept by the eraser between the two samples.
      const minX = Math.min(x, prevX) - radius;
      const minY = Math.min(y, prevY) - radius;
      const maxX = Math.max(x, prevX) + radius;
      const maxY = Math.max(y, prevY) + radius;
      for (const { editor, bbox } of this.#sessionEditors) {
        if (
          maxX < bbox[0] ||
          minX > bbox[2] ||
          maxY < bbox[1] ||
          minY > bbox[3]
        ) {
          continue;
        }
        editor.erase(x, y, radius, prevX, prevY);
      }
      prevX = x;
      prevY = y;
    }
    this.#lastSample = [prevX, prevY];

    for (const { editor } of this.#sessionEditors) {
      editor.renderErase();
    }
  }

  #commit() {
    const cmds = [],
      undos = [];
    for (const { editor } of this.#sessionEditors) {
      const { cmd, undo } = editor.endErase();
      if (cmd && undo) {
        cmds.push(cmd);
        undos.push(undo);
      }
    }

    if (cmds.length === 0) {
      // Nothing was erased: don't add a no-op step to the undo stack.
      return;
    }

    this.parent.addCommands({
      cmd: () => cmds.forEach(f => f()),
      undo: () => undos.forEach(f => f()),
      mustExec: false,
      type: AnnotationEditorParamsType.ERASER_STEP,
    });
  }

  /**
   * End a running session (committing what has been erased so far) or just
   * drop the session state when none is running.
   */
  #cancelEraseSession() {
    if (this.#isErasing && this.parent) {
      this.#endErase(null);
    } else {
      this.#abortEraseSession();
    }
  }

  #abortEraseSession() {
    this.#eraserAC?.abort();
    this.#eraserAC = null;

    if (this.#rafId !== null) {
      window.cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    this.#pendingSamples = [];
    this.#lastSample = null;
    this.#layerRect = null;
    this.#sessionEditors = [];

    const currentPointers = this._uiManager.currentPointers;
    currentPointers.clearPointerIds();
    currentPointers.clearTimeStamp();
    this.#isErasing = false;
  }

  #abortCursor() {
    this.#cursorAC?.abort();
    this.#cursorAC = null;

    if (this.#cursor) {
      this.#cursor.remove();
      this.#cursor = null;
    }

    if (this.div) {
      this.div.style.pointerEvents = "";
      this.div.style.zIndex = "";
    }
  }

  #updateCursor() {
    // The thickness slider only updates the static default (the eraser is
    // never selected), so the cursor size is checked on every move: this
    // writes to the DOM only when the thickness actually changed.
    const thickness = EraserEditor._thickness;
    if (this.#cursor && this.#cursorThickness !== thickness) {
      this.#cursorThickness = thickness;
      this.#cursor.style.width = `${thickness}px`;
      this.#cursor.style.height = `${thickness}px`;
    }
  }

  #displayCursor(event) {
    this.#moveCursor(event);
  }

  #moveCursor(event) {
    if (!this.#cursor) {
      return;
    }

    if (
      this._uiManager.currentPointers.isInitializedAndDifferentPointerType(
        event.pointerType
      )
    ) {
      this.#hideCursor();
      return;
    }

    this.#updateCursor();
    const rect = this.#layerRect ?? this.parent.div.getBoundingClientRect();
    const radius = EraserEditor._thickness / 2;
    const x = event.clientX - rect.left - radius;
    const y = event.clientY - rect.top - radius;

    // A transform doesn't trigger a layout, unlike left/top.
    this.#cursor.style.transform = `translate(${x}px, ${y}px)`;

    this.#showCursor();
  }

  #showCursor() {
    this.#cursor.style.display = "block";
  }

  #hideCursor() {
    this.#cursor.style.display = "none";
  }

  #getErasableEditors() {
    const editors =
      Array.from(this._uiManager.getEditors(this.pageIndex)) || [];
    return editors.filter(ed => ed.erasable && ed?.parent?.div && ed?.div);
  }
}

export { EraserEditor };
