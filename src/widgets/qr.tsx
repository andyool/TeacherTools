import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { QrCode, buildQrSvgPath, drawQrToCanvas } from '../qrcode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { usePersistentState } from '../shared/persistence';
import { announce, showUndoToast } from '../shared/uiKit';
import { createStickyNoteId } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { WidgetSizeTier } from './dashboard';
import { WIDGET_DETAILS } from './registry';

export type QrWidgetPreviewState = {
  error: string | null;
  hostLabel: string | null;
  normalizedUrl: string | null;
  qrCode: QrCode | null;
};

export type QrPayloadType = 'link' | 'text' | 'wifi';

export type QrWifiSecurity = 'WPA' | 'WEP' | 'nopass';

export type QrWifiDraft = {
  password: string;
  security: QrWifiSecurity;
  ssid: string;
};

export type QrHistoryEntry = {
  id: string;
  type: QrPayloadType;
  value: string;
  wifi?: QrWifiDraft;
};

export const QR_WIDGET_SVG_BORDER_MODULES = 2;

const QR_HISTORY_LIMIT = 8;

const EMPTY_WIFI_DRAFT: QrWifiDraft = { password: '', security: 'WPA', ssid: '' };

const QR_PAYLOAD_TYPE_LABELS: Record<QrPayloadType, string> = {
  link: 'Link',
  text: 'Text',
  wifi: 'Wi-Fi'
};

export function normalizeQrPayloadType(raw: unknown): QrPayloadType {
  return raw === 'text' || raw === 'wifi' ? raw : 'link';
}

export function normalizeQrWifiSecurity(raw: unknown): QrWifiSecurity {
  return raw === 'WEP' || raw === 'nopass' ? raw : 'WPA';
}

export function normalizeQrWifiDraft(raw: unknown): QrWifiDraft {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_WIFI_DRAFT };
  }

  const candidate = raw as Partial<QrWifiDraft>;
  return {
    password: typeof candidate.password === 'string' ? candidate.password : '',
    security: normalizeQrWifiSecurity(candidate.security),
    ssid: typeof candidate.ssid === 'string' ? candidate.ssid : ''
  };
}

export function normalizeQrHistory(raw: unknown): QrHistoryEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: QrHistoryEntry[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const candidate = entry as Partial<QrHistoryEntry>;
    if (typeof candidate.value !== 'string' || !candidate.value) {
      continue;
    }

    const type = normalizeQrPayloadType(candidate.type);
    entries.push({
      id: typeof candidate.id === 'string' ? candidate.id : createStickyNoteId(),
      type,
      value: candidate.value,
      ...(type === 'wifi' ? { wifi: normalizeQrWifiDraft(candidate.wifi) } : {})
    });
  }

  return entries.slice(0, QR_HISTORY_LIMIT);
}

export function buildQrWifiPayload(draft: QrWifiDraft) {
  const escapeWifiValue = (value: string) => value.replace(/([\\;,:"])/g, '\\$1');
  const ssid = escapeWifiValue(draft.ssid);

  if (draft.security === 'nopass') {
    return `WIFI:T:nopass;S:${ssid};;`;
  }

  return `WIFI:T:${draft.security};S:${ssid};P:${escapeWifiValue(draft.password)};;`;
}

function isSameQrHistoryEntry(a: QrHistoryEntry, b: QrHistoryEntry) {
  if (a.type !== b.type) {
    return false;
  }

  if (a.type === 'wifi') {
    const aWifi = a.wifi ?? EMPTY_WIFI_DRAFT;
    const bWifi = b.wifi ?? EMPTY_WIFI_DRAFT;
    return (
      aWifi.ssid === bWifi.ssid &&
      aWifi.password === bWifi.password &&
      aWifi.security === bWifi.security
    );
  }

  return a.value === b.value;
}

function getQrHistoryLabel(entry: QrHistoryEntry) {
  if (entry.type === 'wifi') {
    return `Wi-Fi · ${entry.value}`;
  }

  if (entry.type === 'link') {
    return getQrWidgetHostLabel(entry.value) ?? entry.value;
  }

  return entry.value.length > 24 ? `${entry.value.slice(0, 24)}…` : entry.value;
}

function buildQrPngFileName(payloadType: QrPayloadType, preview: QrWidgetPreviewState) {
  const base = preview.hostLabel ?? payloadType;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `qr-${slug || 'code'}.png`;
}

function QrPresentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M6 2.8H2.8V6M10 2.8h3.2V6M6 13.2H2.8V10M10 13.2h3.2V10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function QrGeneratorWidgetContent({
  linkDraft,
  onClear,
  onDraftChange,
  preview
}: {
  linkDraft: string;
  onClear: () => void;
  onDraftChange: (value: string) => void;
  preview: QrWidgetPreviewState;
}) {
  const [payloadType, setPayloadType] = usePersistentState<QrPayloadType>(
    'teacher-tools.qr-payload-type',
    'link',
    {
      normalize: normalizeQrPayloadType
    }
  );
  const [textDraft, setTextDraft] = usePersistentState<string>('teacher-tools.qr-text-draft', '', {
    normalize: (raw, initialValue) => (typeof raw === 'string' ? raw : initialValue)
  });
  const [wifiDraft, setWifiDraft] = usePersistentState<QrWifiDraft>(
    'teacher-tools.qr-wifi-draft',
    EMPTY_WIFI_DRAFT,
    {
      normalize: normalizeQrWifiDraft
    }
  );
  const [history, setHistory] = usePersistentState<QrHistoryEntry[]>('teacher-tools.qr-history', [], {
    normalize: normalizeQrHistory
  });
  const [isPresenting, setIsPresenting] = useState(false);
  const errorId = useId();

  const activePreview =
    payloadType === 'link'
      ? preview
      : payloadType === 'text'
        ? getQrTextPreviewState(textDraft)
        : getQrWifiPreviewState(wifiDraft);
  const caption =
    payloadType === 'link'
      ? activePreview.normalizedUrl ?? ''
      : payloadType === 'wifi'
        ? `Wi-Fi: ${wifiDraft.ssid.trim()}`
        : textDraft.trim();
  const qrSvgViewBoxSize = activePreview.qrCode
    ? activePreview.qrCode.size + QR_WIDGET_SVG_BORDER_MODULES * 2
    : 0;
  const qrSvgPath = activePreview.qrCode
    ? buildQrSvgPath(activePreview.qrCode, QR_WIDGET_SVG_BORDER_MODULES)
    : '';

  useEffect(() => {
    if (activePreview.error) {
      announce(activePreview.error);
    }
  }, [activePreview.error]);

  useEffect(() => {
    if (!isPresenting) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPresenting(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPresenting]);

  const createHistoryEntry = (): QrHistoryEntry | null => {
    if (payloadType === 'link') {
      return activePreview.normalizedUrl
        ? { id: createStickyNoteId(), type: 'link', value: activePreview.normalizedUrl }
        : null;
    }

    if (payloadType === 'text') {
      const value = textDraft.trim();
      return value ? { id: createStickyNoteId(), type: 'text', value } : null;
    }

    const ssid = wifiDraft.ssid.trim();
    return ssid
      ? { id: createStickyNoteId(), type: 'wifi', value: ssid, wifi: { ...wifiDraft, ssid } }
      : null;
  };

  const commitToHistory = () => {
    const entry = createHistoryEntry();
    if (!entry) {
      return;
    }

    setHistory((current) =>
      [entry, ...current.filter((existing) => !isSameQrHistoryEntry(existing, entry))].slice(
        0,
        QR_HISTORY_LIMIT
      )
    );
  };

  const restoreHistoryEntry = (entry: QrHistoryEntry) => {
    setPayloadType(entry.type);
    if (entry.type === 'link') {
      onDraftChange(entry.value);
    } else if (entry.type === 'text') {
      setTextDraft(entry.value);
    } else {
      setWifiDraft(entry.wifi ?? { ...EMPTY_WIFI_DRAFT, ssid: entry.value });
    }
  };

  const removeHistoryEntry = (id: string) => {
    setHistory((current) => current.filter((entry) => entry.id !== id));
  };

  const handlePresent = () => {
    if (!activePreview.qrCode) {
      return;
    }

    commitToHistory();
    setIsPresenting(true);
  };

  const handleCopyPng = async () => {
    if (!activePreview.qrCode) {
      return;
    }

    try {
      const canvas = drawQrToCanvas(activePreview.qrCode);
      if (!canvas) {
        throw new Error('Canvas unavailable');
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        throw new Error('PNG export failed');
      }

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      commitToHistory();
      showUndoToast('QR code copied as an image');
    } catch {
      announce('Could not copy the QR code');
    }
  };

  const handleSavePng = () => {
    if (!activePreview.qrCode) {
      return;
    }

    const canvas = drawQrToCanvas(activePreview.qrCode);
    if (!canvas) {
      announce('Could not save the QR code');
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        announce('Could not save the QR code');
        return;
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = buildQrPngFileName(payloadType, activePreview);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      commitToHistory();
      showUndoToast('QR code saved as PNG');
    }, 'image/png');
  };

  return (
    <div className="qr-widget">
      <div className="segmented-row qr-mode-row widget-top-controls">
        {(['link', 'text', 'wifi'] as const).map((type) => (
          <button
            aria-pressed={payloadType === type}
            className={`text-toggle qr-mode-toggle${
              payloadType === type ? ' qr-mode-toggle--active' : ''
            }`}
            key={type}
            onClick={() => setPayloadType(type)}
            type="button"
          >
            {QR_PAYLOAD_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {payloadType === 'link' ? (
        <div className="qr-widget__top-controls widget-top-controls">
          <div className="field-stack">
            <input
              aria-describedby={activePreview.error ? errorId : undefined}
              aria-invalid={activePreview.error ? true : undefined}
              aria-label="Link to encode"
              className="text-field"
              id="qr-generator-link"
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Paste a link — https://…"
              spellCheck={false}
              type="text"
              value={linkDraft}
            />
          </div>
          <button
            aria-label="Clear QR link"
            className="secondary-link"
            data-compact-icon="×"
            disabled={!linkDraft.trim()}
            onClick={onClear}
            type="button"
          >
            Clear
          </button>
        </div>
      ) : payloadType === 'text' ? (
        <div className="qr-widget__top-controls widget-top-controls">
          <div className="field-stack">
            <textarea
              aria-describedby={activePreview.error ? errorId : undefined}
              aria-invalid={activePreview.error ? true : undefined}
              aria-label="Text to encode"
              className="text-field qr-text-field"
              onChange={(event) => setTextDraft(event.target.value)}
              placeholder="Type any text to encode"
              rows={2}
              value={textDraft}
            />
          </div>
          <button
            aria-label="Clear QR text"
            className="secondary-link"
            data-compact-icon="×"
            disabled={!textDraft.trim()}
            onClick={() => setTextDraft('')}
            type="button"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="qr-wifi-fields widget-top-controls">
          <div className="qr-wifi-fields__row">
            <input
              aria-describedby={activePreview.error ? errorId : undefined}
              aria-invalid={activePreview.error ? true : undefined}
              aria-label="Wi-Fi network name"
              className="text-field"
              onChange={(event) => setWifiDraft({ ...wifiDraft, ssid: event.target.value })}
              placeholder="Network name (SSID)"
              spellCheck={false}
              type="text"
              value={wifiDraft.ssid}
            />
            <input
              aria-label="Wi-Fi password"
              className="text-field"
              disabled={wifiDraft.security === 'nopass'}
              onChange={(event) => setWifiDraft({ ...wifiDraft, password: event.target.value })}
              placeholder={wifiDraft.security === 'nopass' ? 'No password' : 'Password'}
              spellCheck={false}
              type="text"
              value={wifiDraft.password}
            />
          </div>
          <div className="segmented-row qr-mode-row">
            {(['WPA', 'WEP', 'nopass'] as const).map((security) => (
              <button
                aria-pressed={wifiDraft.security === security}
                className={`text-toggle qr-mode-toggle${
                  wifiDraft.security === security ? ' qr-mode-toggle--active' : ''
                }`}
                data-tooltip-content="Wi-Fi security"
                key={security}
                onClick={() => setWifiDraft({ ...wifiDraft, security })}
                type="button"
              >
                {security === 'nopass' ? 'None' : security}
              </button>
            ))}
          </div>
        </div>
      )}

      {activePreview.error ? (
        <p className="qr-widget__inline-error" id={errorId} role="status">
          {activePreview.error}
        </p>
      ) : null}

      {activePreview.qrCode ? (
        <div className="qr-widget__preview-shell">
          <div className="qr-widget__preview-card">
            <svg
              aria-label={`QR code for ${caption}`}
              className="qr-widget__svg"
              role="img"
              viewBox={`0 0 ${qrSvgViewBoxSize} ${qrSvgViewBoxSize}`}
            >
              <rect fill="#ffffff" height={qrSvgViewBoxSize} rx="2" width={qrSvgViewBoxSize} />
              <path d={qrSvgPath} fill="currentColor" />
            </svg>
          </div>

          <div className="qr-widget__meta">
            {activePreview.hostLabel ? <span className="pill">{activePreview.hostLabel}</span> : null}
            {payloadType === 'link' ? (
              <p className="helper-text qr-widget__url">{activePreview.normalizedUrl}</p>
            ) : null}
          </div>

          <div className="qr-widget__actions">
            <button
              aria-label="Present QR code full window"
              className="text-toggle qr-action"
              data-tooltip-content="Fill the window"
              onClick={handlePresent}
              type="button"
            >
              <QrPresentIcon />
              Present
            </button>
            <button
              aria-label="Copy QR code as a PNG image"
              className="text-toggle qr-action"
              data-tooltip-content="Copy PNG"
              onClick={() => {
                void handleCopyPng();
              }}
              type="button"
            >
              Copy
            </button>
            <button
              aria-label="Save QR code as a PNG file"
              className="text-toggle qr-action"
              data-tooltip-content="Save PNG"
              onClick={handleSavePng}
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="widget-empty-state qr-widget__empty">
          <svg aria-hidden="true" className="qr-widget__ghost" viewBox="0 0 48 48">
            <g fill="currentColor">
              <path d="M4 4h14v14H4V4zm3 3v8h8V7H7zm2 2h4v4H9V9z" />
              <path d="M30 4h14v14H30V4zm3 3v8h8V7h-8zm2 2h4v4h-4V9z" />
              <path d="M4 30h14v14H4V30zm3 3v8h8v-8H7zm2 2h4v4H9v-4z" />
              <path d="M22 4h4v4h-4V4zm0 8h4v4h-4v-4zm0 8h4v4h-4v-4zm-18 2h4v4H4v-4zm8 0h4v4h-4v-4zm18 0h4v4h-4v-4zm8 0h4v4h-4v-4zm4 8h4v4h-4v-4zm-8-4h4v4h-4v-4zm-8 4h4v4h-4v-4zm8 4h4v4h-4v-4zm8 4h4v4h-4v-4zm-16 0h4v4h-4v-4z" />
            </g>
          </svg>
        </div>
      )}

      {history.length > 0 ? (
        <div aria-label="Recent QR codes" className="qr-history">
          {history.map((entry) => (
            <span className="qr-history__chip" key={entry.id}>
              <button
                aria-label={`Restore ${getQrHistoryLabel(entry)}`}
                className="qr-history__restore"
                data-tooltip-content="Restore"
                onClick={() => restoreHistoryEntry(entry)}
                type="button"
              >
                {getQrHistoryLabel(entry)}
              </button>
              <button
                aria-label={`Remove ${getQrHistoryLabel(entry)} from history`}
                className="qr-history__remove"
                onClick={() => removeHistoryEntry(entry.id)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {isPresenting && activePreview.qrCode
        ? createPortal(
            <div
              aria-label="QR code presentation"
              className="qr-present"
              onClick={() => setIsPresenting(false)}
              role="dialog"
            >
              <svg
                aria-label={`QR code for ${caption}`}
                className="qr-present__svg"
                role="img"
                viewBox={`0 0 ${qrSvgViewBoxSize} ${qrSvgViewBoxSize}`}
              >
                <rect fill="#ffffff" height={qrSvgViewBoxSize} width={qrSvgViewBoxSize} />
                <path d={qrSvgPath} fill="#10151d" />
              </svg>
              {caption ? <p className="qr-present__caption">{caption}</p> : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function QrGeneratorWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
}) {
  const qrGenerator = useQrWidgetState();

  return (
    <WidgetCard
      badge={qrGenerator.preview.qrCode ? 'Ready' : null}
      collapsed={false}
      description={WIDGET_DETAILS['qr-generator'].description}
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS['qr-generator'].title}
          widgetId="qr-generator"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      sizeTier={sizeTier}
      title={WIDGET_DETAILS['qr-generator'].title}
      widgetId="qr-generator"
    >
      <QrGeneratorWidgetContent
        linkDraft={qrGenerator.linkDraft}
        onClear={qrGenerator.clearLink}
        onDraftChange={qrGenerator.setLinkDraft}
        preview={qrGenerator.preview}
      />
    </WidgetCard>
  );
}

export function useQrWidgetState() {
  const [linkDraft, setLinkDraft] = usePersistentState<string>('teacher-tools.qr-link-draft', '');

  return {
    clearLink: () => setLinkDraft(''),
    linkDraft,
    preview: getQrWidgetPreviewState(linkDraft),
    setLinkDraft
  };
}

export function getQrWidgetPreviewState(linkDraft: string): QrWidgetPreviewState {
  const trimmedLink = linkDraft.trim();
  if (!trimmedLink) {
    return {
      error: null,
      hostLabel: null,
      normalizedUrl: null,
      qrCode: null
    };
  }

  const normalizedUrl = normalizeQrWidgetUrl(trimmedLink);
  if (!normalizedUrl) {
    return {
      error: 'Enter a valid web link.',
      hostLabel: null,
      normalizedUrl: null,
      qrCode: null
    };
  }

  try {
    return {
      error: null,
      hostLabel: getQrWidgetHostLabel(normalizedUrl),
      normalizedUrl,
      qrCode: QrCode.encodeText(normalizedUrl)
    };
  } catch {
    return {
      error: 'Too long to encode.',
      hostLabel: null,
      normalizedUrl,
      qrCode: null
    };
  }
}

export function getQrTextPreviewState(textDraft: string): QrWidgetPreviewState {
  const trimmedText = textDraft.trim();
  if (!trimmedText) {
    return {
      error: null,
      hostLabel: null,
      normalizedUrl: null,
      qrCode: null
    };
  }

  try {
    return {
      error: null,
      hostLabel: null,
      normalizedUrl: trimmedText,
      qrCode: QrCode.encodeText(trimmedText)
    };
  } catch {
    return {
      error: 'Too long to encode.',
      hostLabel: null,
      normalizedUrl: trimmedText,
      qrCode: null
    };
  }
}

export function getQrWifiPreviewState(draft: QrWifiDraft): QrWidgetPreviewState {
  const ssid = draft.ssid.trim();
  if (!ssid && !draft.password) {
    return {
      error: null,
      hostLabel: null,
      normalizedUrl: null,
      qrCode: null
    };
  }

  if (!ssid) {
    return {
      error: 'Add a network name.',
      hostLabel: null,
      normalizedUrl: null,
      qrCode: null
    };
  }

  if (draft.security !== 'nopass' && !draft.password) {
    return {
      error: 'Add a password, or set security to None.',
      hostLabel: ssid,
      normalizedUrl: null,
      qrCode: null
    };
  }

  const payload = buildQrWifiPayload({ ...draft, ssid });

  try {
    return {
      error: null,
      hostLabel: ssid,
      normalizedUrl: payload,
      qrCode: QrCode.encodeText(payload)
    };
  } catch {
    return {
      error: 'Too long to encode.',
      hostLabel: ssid,
      normalizedUrl: payload,
      qrCode: null
    };
  }
}

export function normalizeQrWidgetUrl(value: string) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    if (!url.hostname) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function getQrWidgetHostLabel(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '');
    return hostname || null;
  } catch {
    return null;
  }
}
