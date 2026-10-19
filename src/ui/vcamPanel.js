/** Scene panel VCAM card: pairing QR, live status, lens and take controls. */
import { formatNumber, msg, t, tn } from '../i18n/index.js';
import { drawQr, encodeQr } from '../vcam/qr.js';

const FOCAL_RANGE = [12, 400];
const FSTOP_RANGE = [1.2, 22];
const logMap = ([low, high], v) => low * (high / low) ** v;
const logUnmap = ([low, high], value) =>
  Math.log(value / low) / Math.log(high / low);

const HOLD_REASONS = Object.freeze({
  phone: msg('Held from the phone'),
  desktop: msg(
    'Held: you moved the globe — press RESUME or tap HOLD on the phone',
  ),
  'desktop-button': msg('Held'),
  navigation: msg('Held: another view took the camera'),
  refused: msg('Camera unavailable — exit cockpit first'),
});

function vcamElements(root = document) {
  const ids = {
    toggle: 'vcam-toggle-btn',
    card: 'vcam-card',
    qr: 'vcam-qr',
    code: 'vcam-code',
    address: 'vcam-address',
    url: 'vcam-url',
    status: 'vcam-status',
    scale: 'vcam-scale',
    focal: 'vcam-focal',
    focalValue: 'vcam-focal-value',
    dof: 'vcam-dof',
    fStop: 'vcam-fstop',
    fStopValue: 'vcam-fstop-value',
    hold: 'vcam-hold-btn',
    recenter: 'vcam-recenter-btn',
    record: 'vcam-record-btn',
    end: 'vcam-end-btn',
  };
  return Object.fromEntries(
    Object.entries(ids).map(([key, id]) => [key, root.getElementById(id)]),
  );
}

function statusText(state) {
  if (state.status === 'error')
    return t(state.error || 'Phone camera unavailable');
  if (state.status === 'starting') return t('Starting…');
  if (state.status === 'idle') return t('Phone camera off');
  if (!state.phoneConnected)
    return t('Scan the code with a phone on the same Wi-Fi');
  const mode =
    state.mode === '6dof' ? t('AR tracking (6DoF)') : t('Gyro tracking (3DoF)');
  if (state.recording)
    return t('Recording {time} · {mode}', {
      time: formatNumber(state.recordingSec, { maximumFractionDigits: 1 }),
      mode,
    });
  if (state.held) return t(HOLD_REASONS[state.holdReason] || 'Held');
  if (state.takes)
    return tn(
      state.takes,
      'Phone connected · {mode} · {count} take',
      'Phone connected · {mode} · {count} takes',
      { mode },
    );
  return t('Phone connected · {mode}', { mode });
}

/**
 * Bind the VCAM card to a controller. Opening the card starts a pairing
 * session; END stops it. Returns a disposer.
 */
export function bindVcamPanel(controller, elements = vcamElements()) {
  if (!elements.toggle || !elements.card) return () => {};
  const removers = [];
  let lastUrl = null;
  let ticker = null;
  const listen = (target, type, handler) => {
    target?.addEventListener(type, handler);
    removers.push(() => target?.removeEventListener(type, handler));
  };

  const setOpen = (open) => {
    elements.card.hidden = !open;
    elements.toggle.setAttribute('aria-expanded', String(open));
    elements.toggle.classList.toggle('active', open);
  };

  function present(state) {
    const active = state.status !== 'idle';
    elements.toggle.classList.toggle('vcam-live', state.phoneConnected);
    elements.code.textContent = state.code || '······';
    if (state.pairingUrl !== lastUrl) {
      lastUrl = state.pairingUrl;
      elements.url.textContent = state.pairingUrl || '';
      if (state.pairingUrl) elements.url.href = state.pairingUrl;
      else elements.url.removeAttribute('href');
      const context = elements.qr.getContext?.('2d');
      if (state.pairingUrl) drawQr(elements.qr, encodeQr(state.pairingUrl));
      else if (context)
        context.clearRect(0, 0, elements.qr.width, elements.qr.height);
      elements.qr.hidden = !state.pairingUrl;
    }
    const options = state.addresses.map((address) => address);
    if (
      elements.address.options.length !== options.length ||
      [...elements.address.options].some(
        (option, i) => option.value !== options[i],
      )
    ) {
      elements.address.replaceChildren(
        ...options.map((address) => new Option(address, address)),
      );
    }
    elements.address.value = state.address || '';
    elements.address.hidden = options.length < 2;
    elements.status.textContent = statusText(state);
    elements.status.classList.toggle('error', state.status === 'error');

    const { settings } = state;
    const scale = String(settings.scale);
    if (![...elements.scale.options].some((option) => option.value === scale))
      elements.scale.append(
        new Option(`1:${formatNumber(settings.scale)}`, scale),
      );
    elements.scale.value = scale;
    if (document.activeElement !== elements.focal)
      elements.focal.value = String(logUnmap(FOCAL_RANGE, settings.focalMm));
    // Unit symbols stay as they are in every language.
    elements.focalValue.textContent = `${formatNumber(Math.round(settings.focalMm))}mm`;
    if (document.activeElement !== elements.fStop)
      elements.fStop.value = String(logUnmap(FSTOP_RANGE, settings.fStop));
    elements.fStopValue.textContent = `f/${formatNumber(settings.fStop, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    })}`;
    elements.dof.checked = settings.dof;

    for (const control of [elements.hold, elements.recenter, elements.record])
      control.disabled = !state.phoneConnected;
    elements.end.disabled = !active;
    elements.hold.setAttribute('aria-pressed', String(state.held));
    elements.hold.textContent = state.held ? t('RESUME') : t('HOLD');
    elements.record.setAttribute('aria-pressed', String(state.recording));
    elements.record.textContent = state.recording ? t('■ STOP') : t('● REC');

    clearInterval(ticker);
    ticker = state.recording
      ? setInterval(() => present(controller.getState()), 500)
      : null;
  }

  listen(elements.toggle, 'click', () => {
    const open = elements.card.hidden;
    setOpen(open);
    if (open && !controller.active) controller.start();
  });
  listen(elements.end, 'click', () => {
    controller.stop();
    setOpen(false);
  });
  listen(elements.address, 'change', () =>
    controller.setAddress(elements.address.value),
  );
  listen(elements.scale, 'change', () =>
    controller.set('scale', Number(elements.scale.value)),
  );
  listen(elements.focal, 'input', () =>
    controller.set(
      'focalMm',
      logMap(FOCAL_RANGE, Number(elements.focal.value)),
    ),
  );
  listen(elements.fStop, 'input', () =>
    controller.set('fStop', logMap(FSTOP_RANGE, Number(elements.fStop.value))),
  );
  listen(elements.dof, 'change', () =>
    controller.set('dof', elements.dof.checked),
  );
  listen(elements.hold, 'click', () =>
    controller.getState().held ? controller.release() : controller.hold(),
  );
  listen(elements.recenter, 'click', () => controller.recenter());
  listen(elements.record, 'click', () => controller.toggleRecording());

  const unsubscribe = controller.subscribe(present);
  return () => {
    clearInterval(ticker);
    unsubscribe();
    for (const remove of removers.splice(0)) remove();
    setOpen(false);
  };
}
