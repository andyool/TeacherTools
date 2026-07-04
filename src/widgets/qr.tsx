import { QrCode, buildQrSvgPath } from '../qrcode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { usePersistentState } from '../shared/persistence';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { WidgetSizeTier } from './dashboard';
import { WIDGET_DETAILS } from './registry';

export type QrWidgetPreviewState = {
  error: string | null;
  hostLabel: string | null;
  normalizedUrl: string | null;
  qrCode: QrCode | null;
};

export const QR_WIDGET_SVG_BORDER_MODULES = 2;

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
  const qrSvgViewBoxSize = preview.qrCode ? preview.qrCode.size + QR_WIDGET_SVG_BORDER_MODULES * 2 : 0;
  const qrSvgPath = preview.qrCode
    ? buildQrSvgPath(preview.qrCode, QR_WIDGET_SVG_BORDER_MODULES)
    : '';

  return (
    <div className="qr-widget">
      <div className="qr-widget__top-controls widget-top-controls">
        <div className="field-stack">
          <label className="field-label" htmlFor="qr-generator-link">
            Link
          </label>
          <input
            className="text-field"
            id="qr-generator-link"
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="https://school.example.com/check-in"
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

      {preview.qrCode ? (
        <div className="qr-widget__preview-shell">
          <div className="qr-widget__preview-card">
            <svg
              aria-label={`QR code for ${preview.normalizedUrl}`}
              className="qr-widget__svg"
              role="img"
              viewBox={`0 0 ${qrSvgViewBoxSize} ${qrSvgViewBoxSize}`}
            >
              <rect fill="#ffffff" height={qrSvgViewBoxSize} rx="2" width={qrSvgViewBoxSize} />
              <path d={qrSvgPath} fill="currentColor" />
            </svg>
          </div>

          <div className="qr-widget__meta">
            {preview.hostLabel ? <span className="pill">{preview.hostLabel}</span> : null}
            <p className="helper-text qr-widget__url">{preview.normalizedUrl}</p>
          </div>
        </div>
      ) : (
        <div className="widget-empty-state qr-widget__empty">
          <p className="empty-copy">
            {preview.error ?? 'Paste a web link and the QR code will generate here instantly.'}
          </p>
        </div>
      )}

      <p className="helper-text qr-widget__hint">
        {preview.qrCode
          ? 'The code updates directly on the dashboard as you type.'
          : 'Use a full web address or a domain name and the widget will handle the rest.'}
      </p>
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
      description="Paste a link and the QR code appears right here."
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
      error: 'Enter a valid web link such as https://school.example.com.',
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
      error: 'That link is too long to encode into a QR code.',
      hostLabel: null,
      normalizedUrl,
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
