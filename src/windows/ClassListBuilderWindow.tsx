import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesktopWindowContext } from '../electron-types';
import { InterfaceScaleControls, useInterfaceScaleControls } from '../app/interfaceScale';
import { useResolvedTheme, useThemePreferenceState } from '../app/theme';
import { fallbackContext, returnToTeacherTools } from '../app/windowContext';
import { splitNames } from '../shared/utils';
import { WINDOW_EDGE_MARGIN } from '../shared/windowSizing';
import { activateClassList, createPredictableListId, upsertClassList } from '../widgets/classLists';
import { removeClassListFromPicker, usePickerState } from '../widgets/picker';

export const CLASS_LIST_TEXTAREA_MIN_HEIGHT = 176;

export function ClassListBuilderWindow({ windowContext }: { windowContext: DesktopWindowContext }) {
  const stageRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastRequestedHeightRef = useRef(0);
  const [picker, setPicker] = usePickerState();
  const [themePreference] = useThemePreferenceState();
  const {
    canDecreaseInterfaceScale,
    canIncreaseInterfaceScale,
    decreaseInterfaceScale,
    increaseInterfaceScale,
    interfaceScale
  } = useInterfaceScaleControls();
  const resolvedTheme = useResolvedTheme(themePreference);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const [builderListId, setBuilderListId] = useState<string | null>(() => selectedList?.id ?? null);
  const [builderListName, setBuilderListName] = useState(() => selectedList?.name ?? '');
  const [builderStudents, setBuilderStudents] = useState(() =>
    selectedList ? selectedList.students.join('\n') : ''
  );
  const [isCreatingNewList, setIsCreatingNewList] = useState(() => !selectedList);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        returnToTeacherTools();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (isCreatingNewList) {
      return;
    }

    if (builderListId) {
      const activeList = picker.lists.find((list) => list.id === builderListId);
      if (activeList) {
        return;
      }
    }

    if (selectedList) {
      setBuilderListId(selectedList.id);
      setBuilderListName(selectedList.name);
      setBuilderStudents(selectedList.students.join('\n'));
      return;
    }

    setIsCreatingNewList(true);
    setBuilderListId(null);
    setBuilderListName('');
    setBuilderStudents('');
  }, [builderListId, isCreatingNewList, picker.lists, selectedList]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const panel = panelRef.current;
    const stage = stageRef.current;

    if (!textarea || !panel || !stage) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.overflowY = 'hidden';

    const naturalTextareaHeight = Math.max(textarea.scrollHeight, CLASS_LIST_TEXTAREA_MIN_HEIGHT);
    textarea.style.height = `${naturalTextareaHeight}px`;

    const stageStyles = window.getComputedStyle(stage);
    const stagePadding =
      parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
    const display = windowContext.anchor?.display ?? fallbackContext.anchor?.display;
    const windowTop =
      (typeof window.screenY === 'number' && Number.isFinite(window.screenY)
        ? window.screenY
        : typeof window.screenTop === 'number' && Number.isFinite(window.screenTop)
          ? window.screenTop
          : null) ?? (display ? display.y + WINDOW_EDGE_MARGIN : WINDOW_EDGE_MARGIN);
    const maxWindowHeight = display
      ? Math.max(0, display.y + display.height - windowTop - WINDOW_EDGE_MARGIN)
      : Number.POSITIVE_INFINITY;
    const naturalWindowHeight = Math.ceil(Math.max(panel.scrollHeight, panel.offsetHeight) + stagePadding);
    const overflow = Number.isFinite(maxWindowHeight)
      ? Math.max(0, naturalWindowHeight - maxWindowHeight)
      : 0;
    const nextTextareaHeight = Math.max(
      CLASS_LIST_TEXTAREA_MIN_HEIGHT,
      naturalTextareaHeight - overflow
    );

    textarea.style.height = `${nextTextareaHeight}px`;
    textarea.style.overflowY = nextTextareaHeight < naturalTextareaHeight ? 'auto' : 'hidden';
  }, [builderStudents, builderListId, interfaceScale, isCreatingNewList, windowContext]);

  useLayoutEffect(() => {
    if (!window.electronAPI || !stageRef.current || !panelRef.current) {
      return;
    }

    const stage = stageRef.current;
    const panel = panelRef.current;
    let cancelled = false;

    const reportHeight = () => {
      const stageStyles = window.getComputedStyle(stage);
      const stagePadding =
        parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
      const desiredHeight = Math.ceil(Math.max(panel.scrollHeight, panel.offsetHeight) + stagePadding);

      if (desiredHeight === lastRequestedHeightRef.current) {
        return;
      }

      lastRequestedHeightRef.current = desiredHeight;
      window.electronAPI?.getCurrentWindowBounds().then((bounds) => {
        if (cancelled) {
          return;
        }

        window.electronAPI?.setCurrentWindowBounds({
          ...bounds,
          height: desiredHeight
        });
      });
    };

    reportHeight();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(reportHeight);
    });

    resizeObserver.observe(panel);
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, [builderListId, builderStudents, interfaceScale, isCreatingNewList, picker.lists.length]);

  const draftStudents = splitNames(builderStudents);

  const startNewList = () => {
    setIsCreatingNewList(true);
    setBuilderListId(null);
    setBuilderListName('');
    setBuilderStudents('');
  };

  const editList = (listId: string) => {
    const nextList = picker.lists.find((list) => list.id === listId);
    if (!nextList) {
      return;
    }

    setPicker((current) => activateClassList(current, listId));
    setIsCreatingNewList(false);
    setBuilderListId(nextList.id);
    setBuilderListName(nextList.name);
    setBuilderStudents(nextList.students.join('\n'));
  };

  const saveClassList = () => {
    const nextName = builderListName.trim();
    if (!nextName || !draftStudents.length) {
      return;
    }

    const targetListId =
      builderListId ??
      createPredictableListId(nextName, picker.lists.map((list) => list.id));

    setPicker((current) =>
      upsertClassList(current, {
        listId: targetListId,
        name: nextName,
        students: draftStudents
      })
    );

    setIsCreatingNewList(false);
    setBuilderListId(targetListId);
    setBuilderListName(nextName);
    setBuilderStudents(draftStudents.join('\n'));
  };

  const deleteClassList = () => {
    if (!builderListId) {
      return;
    }

    setPicker((current) => removeClassListFromPicker(current, builderListId));
    startNewList();
  };

  return (
    <main
      aria-label="Class list builder"
      className="window-stage window-stage--builder window-stage--class-list-builder"
      ref={stageRef}
    >
      <section
        className="panel panel--builder panel--class-list-builder"
        data-theme={resolvedTheme}
        ref={panelRef}
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content">
          <header className="panel-header">
            <div className="panel-header__title">
              <span className="panel-kicker">Class lists</span>
              <h1 className="panel-title">Builder</h1>
            </div>
            <div className="panel-actions">
              <InterfaceScaleControls
                canDecrease={canDecreaseInterfaceScale}
                canIncrease={canIncreaseInterfaceScale}
                onDecrease={decreaseInterfaceScale}
                onIncrease={increaseInterfaceScale}
                scale={interfaceScale}
              />
              <button className="toolbar-link button-tone--action" onClick={startNewList} type="button">
                New
              </button>
              <button
                aria-label="Close class list builder"
                className="icon-button icon-button--close"
                onClick={() => window.electronAPI?.closeClassListBuilder()}
                type="button"
              >
                ×
              </button>
            </div>
          </header>

          <div className="builder-layout builder-layout--class-list">
            <aside className="builder-sidebar">
              <div className="builder-sidebar__head">
                <span className="card-label">Lists</span>
                <span className="badge">{picker.lists.length}</span>
              </div>

              <div className="builder-list">
                {picker.lists.length > 0 ? (
                  picker.lists.map((list) => (
                    <button
                      className={`builder-list__button ${
                        list.id === builderListId ? 'builder-list__button--active' : ''
                      }`}
                      key={list.id}
                      onClick={() => editList(list.id)}
                      type="button"
                    >
                      <span>{list.name}</span>
                      <span>{list.students.length}</span>
                    </button>
                  ))
                ) : (
                  <p className="empty-copy">No lists yet.</p>
                )}
              </div>
            </aside>

            <section className="builder-editor">
              <div className="field-stack">
                <label className="field-label" htmlFor="class-list-name">
                  List name
                </label>
                <input
                  className="text-field"
                  id="class-list-name"
                  onChange={(event) => setBuilderListName(event.target.value)}
                  placeholder="Period 1"
                  type="text"
                  value={builderListName}
                />
              </div>

              <div className="field-stack field-stack--fill builder-students-field">
                <label className="field-label" htmlFor="class-list-students">
                  Students
                </label>
                <textarea
                  className="text-area text-area--builder"
                  id="class-list-students"
                  onChange={(event) => setBuilderStudents(event.target.value)}
                  placeholder="One name per line or separated by commas"
                  ref={textareaRef}
                  value={builderStudents}
                />
                <p className="helper-text">
                  {draftStudents.length} student{draftStudents.length === 1 ? '' : 's'}
                </p>
              </div>

              <div className="builder-footer">
                <button
                  className="primary-link"
                  disabled={!builderListName.trim() || draftStudents.length === 0}
                  onClick={saveClassList}
                  type="button"
                >
                  {builderListId ? 'Save list' : 'Add list'}
                </button>
                {builderListId && (
                  <button className="danger-link" onClick={deleteClassList} type="button">
                    Delete
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
