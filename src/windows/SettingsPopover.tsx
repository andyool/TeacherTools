import { useState } from 'react';
import type { AppUpdateState, TimerChimeSound, TimerSpeechVoice } from '../electron-types';
import { getAppUpdateTooltip } from '../app/appUpdate';
import type { ColorModePaletteTarget, ColorModePreferences } from '../app/colorMode';
import { ColorModeTriggerButton } from '../app/colorMode';
import { InterfaceScaleControls, formatInterfaceScaleLabel } from '../app/interfaceScale';
import type { ThemeMode, ThemePreference } from '../app/theme';
import { ThemeCycleIcon, getThemePreferenceLabel } from '../app/theme';
import { TIMER_CHIME_SOUND_OPTIONS } from '../widgets/timer';

export function SettingsPopover({
  appUpdate,
  appUpdateActionDisabled,
  appUpdateButtonLabel,
  appUpdateStatusLabel,
  appUpdateStatusTone,
  canDecreaseInterfaceScale,
  canIncreaseInterfaceScale,
  colorModePaletteTarget,
  colorModePreferences,
  decreaseInterfaceScale,
  increaseInterfaceScale,
  interfaceScale,
  isLaunchAtLoginSaving,
  launchAtLogin,
  nextThemePreference,
  onAppUpdateAction,
  onTimerChimeEnabledChange,
  onTimerChimeSoundChange,
  onLaunchAtLoginChange,
  onThemePreferenceChange,
  onTimerSpeechVoiceChange,
  onTimerVoiceEnabledChange,
  onToggleBackgroundColor,
  resolvedTheme,
  themePreference,
  timerChimeEnabled,
  timerChimeSound,
  timerVoiceEnabled,
  timerSpeechVoice
}: {
  appUpdate: AppUpdateState;
  appUpdateActionDisabled: boolean;
  appUpdateButtonLabel: string;
  appUpdateStatusLabel: string;
  appUpdateStatusTone: string;
  canDecreaseInterfaceScale: boolean;
  canIncreaseInterfaceScale: boolean;
  colorModePaletteTarget: ColorModePaletteTarget | null;
  colorModePreferences: ColorModePreferences;
  decreaseInterfaceScale: () => void;
  increaseInterfaceScale: () => void;
  interfaceScale: number;
  isLaunchAtLoginSaving: boolean;
  launchAtLogin: boolean;
  nextThemePreference: ThemePreference;
  onAppUpdateAction: () => void;
  onTimerChimeEnabledChange: (enabled: boolean) => void;
  onTimerChimeSoundChange: (sound: TimerChimeSound) => void;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onThemePreferenceChange: () => void;
  onTimerSpeechVoiceChange: (voice: TimerSpeechVoice) => void;
  onTimerVoiceEnabledChange: (enabled: boolean) => void;
  onToggleBackgroundColor: (anchorRect: DOMRect) => void;
  resolvedTheme: ThemeMode;
  themePreference: ThemePreference;
  timerChimeEnabled: boolean;
  timerChimeSound: TimerChimeSound;
  timerVoiceEnabled: boolean;
  timerSpeechVoice: TimerSpeechVoice;
}) {
  const [dataActionStatus, setDataActionStatus] = useState('');
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);

  const runDataAction = (
    action: (() => Promise<{ canceled: boolean; errorMessage?: string; ok: boolean }>) | undefined,
    successMessage: string
  ) => {
    if (!action) {
      return;
    }

    setDataActionStatus('');
    void action()
      .then((result) => {
        if (result.ok) {
          setDataActionStatus(successMessage);
        } else if (!result.canceled) {
          setDataActionStatus(result.errorMessage ?? 'That did not work. Try again.');
        }
      })
      .catch(() => {
        setDataActionStatus('That did not work. Try again.');
      });
  };

  return (
    <div aria-label="Settings" className="settings-popout" role="dialog">
      <div className="settings-popout__header">
        <div>
          <span className="panel-kicker">Settings</span>
          <h2 className="settings-popout__title">App controls</h2>
        </div>
        <span className={`update-status-pill update-status-pill--${appUpdateStatusTone}`}>
          {appUpdateStatusLabel}
        </span>
      </div>

      <div className="settings-section">
        <span className="card-label">System</span>
        <label className="settings-toggle">
          <span className="settings-toggle__text">
            <span className="settings-toggle__title">Open at login</span>
            <span className="settings-toggle__copy">Start TeacherTools when the computer starts.</span>
          </span>
          <input
            checked={launchAtLogin}
            disabled={isLaunchAtLoginSaving || !window.electronAPI?.setLaunchAtLogin}
            onChange={(event) => onLaunchAtLoginChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" className="settings-toggle__switch" />
        </label>
        <label className="settings-toggle">
          <span className="settings-toggle__text">
            <span className="settings-toggle__title">Timer voice alerts</span>
            <span className="settings-toggle__copy">Speak halfway, 10% remaining, and time&apos;s up.</span>
          </span>
          <input
            checked={timerVoiceEnabled}
            disabled={!window.electronAPI?.setTimerVoiceEnabled}
            onChange={(event) => onTimerVoiceEnabledChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" className="settings-toggle__switch" />
        </label>
        <label className="settings-toggle">
          <span className="settings-toggle__text">
            <span className="settings-toggle__title">Timer chime alerts</span>
            <span className="settings-toggle__copy">Play countdown chimes without stopping the timer.</span>
          </span>
          <input
            checked={timerChimeEnabled}
            disabled={!window.electronAPI?.setTimerChimeEnabled}
            onChange={(event) => onTimerChimeEnabledChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" className="settings-toggle__switch" />
        </label>
        <div className="settings-row">
          <span className="settings-row__label">Chime sound</span>
          <div className="settings-row__cluster settings-row__cluster--wrap">
            {TIMER_CHIME_SOUND_OPTIONS.map((option) => (
              <button
                aria-pressed={timerChimeSound === option.id}
                className={`text-toggle settings-voice-toggle ${
                  timerChimeSound === option.id ? 'text-toggle--active' : ''
                }`}
                disabled={!timerChimeEnabled || !window.electronAPI?.setTimerChimeSound}
                key={option.id}
                onClick={() => onTimerChimeSoundChange(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Timer voice</span>
          <div className="settings-row__cluster">
            {(['male', 'female'] as const).map((voice) => (
              <button
                aria-pressed={timerSpeechVoice === voice}
                className={`text-toggle settings-voice-toggle ${
                  timerSpeechVoice === voice ? 'text-toggle--active' : ''
                }`}
                disabled={!timerVoiceEnabled || !window.electronAPI?.setTimerSpeechVoice}
                key={voice}
                onClick={() => onTimerSpeechVoiceChange(voice)}
                type="button"
              >
                {voice === 'male' ? 'Male' : 'Female'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <span className="card-label">Appearance</span>
        <div className="settings-row">
          <span className="settings-row__label">Theme</span>
          <button
            aria-label={`Theme ${getThemePreferenceLabel(themePreference)}. Switch to ${getThemePreferenceLabel(nextThemePreference)}.`}
            className="toolbar-link button-tone--theme settings-row__action"
            onClick={onThemePreferenceChange}
            type="button"
          >
            <ThemeCycleIcon preference={themePreference} />
            <span>{getThemePreferenceLabel(themePreference)}</span>
          </button>
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Interface size</span>
          <div className="settings-row__cluster">
            <InterfaceScaleControls
              canDecrease={canDecreaseInterfaceScale}
              canIncrease={canIncreaseInterfaceScale}
              onDecrease={decreaseInterfaceScale}
              onIncrease={increaseInterfaceScale}
              scale={interfaceScale}
            />
            <span className="settings-value">{formatInterfaceScaleLabel(interfaceScale)}</span>
          </div>
        </div>
        {resolvedTheme === 'color' ? (
          <div className="settings-row">
            <span className="settings-row__label">Dashboard colour</span>
            <ColorModeTriggerButton
              active={colorModePaletteTarget?.kind === 'background'}
              appearance="background"
              label="Change dashboard background colour"
              onClick={(event) => onToggleBackgroundColor(event.currentTarget.getBoundingClientRect())}
              swatchId={colorModePreferences.backgroundColorId}
              variant="toolbar"
            />
          </div>
        ) : null}
      </div>

      <div className="settings-section">
        <span className="card-label">Data</span>
        <div className="settings-row__cluster settings-row__cluster--wrap">
          <button
            className="toolbar-link"
            disabled={!window.electronAPI?.exportAppData}
            onClick={() => runDataAction(window.electronAPI?.exportAppData, 'Backup saved.')}
            type="button"
          >
            Export backup
          </button>
          <button
            className="toolbar-link"
            disabled={!window.electronAPI?.importAppData}
            onClick={() => runDataAction(window.electronAPI?.importAppData, 'Backup restored.')}
            type="button"
          >
            Import backup
          </button>
          <button
            className="toolbar-link"
            disabled={!window.electronAPI?.revealDataFolder}
            onClick={() => void window.electronAPI?.revealDataFolder?.()}
            type="button"
          >
            Show data folder
          </button>
        </div>
        {dataActionStatus ? <p className="settings-copy" role="status">{dataActionStatus}</p> : null}
      </div>

      <div className="settings-section">
        <span className="card-label">Updates</span>
        <p className="settings-copy">{getAppUpdateTooltip(appUpdate)}</p>
        <button
          className={`toolbar-link settings-update-button ${
            appUpdate.status === 'downloaded'
              ? 'toolbar-link--accent'
              : appUpdate.status === 'error' || appUpdate.status === 'unsupported'
                ? 'button-tone--warning'
                : appUpdate.status === 'up-to-date'
                  ? 'button-tone--selection'
                  : ''
          }`}
          disabled={appUpdateActionDisabled}
          onClick={onAppUpdateAction}
          type="button"
        >
          {appUpdateButtonLabel}
        </button>
        {appUpdate.releaseNotes ? (
          <>
            <button
              aria-expanded={showReleaseNotes}
              className="secondary-link"
              onClick={() => setShowReleaseNotes((current) => !current)}
              type="button"
            >
              {showReleaseNotes ? 'Hide release notes' : "What's new"}
            </button>
            {showReleaseNotes ? (
              <p className="settings-copy settings-release-notes">{appUpdate.releaseNotes}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
