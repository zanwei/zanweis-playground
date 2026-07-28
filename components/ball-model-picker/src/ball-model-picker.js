import { createPlinkoRoute } from './plinko-route.js';
import { createPinballState, stepPinball } from './pinball-physics.js';

const STOPS = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'extra-high', label: 'Extra High' },
  { id: 'ultra', label: 'Ultra' },
];

const STOP_POSITIONS = [8.333, 25, 41.667, 58.333, 75, 91.667];
const INITIAL_STOP = 2;

const boltIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13.4 2.7 5.5 13.8h5.1L9.8 21.3l8.1-11.1h-5.1l.6-7.5Z"/>
  </svg>`;

const closeIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m7 7 10 10M17 7 7 17"/>
  </svg>`;

const chevronIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m7 9 5 5 5-5"/>
  </svg>`;

const css = `
:host {
  --page: #0D0F0C;
  --card: #1E1F24;
  --board: #141517;
  --well: #282A2F;
  --peg: #50524F;
  --quiet: #777A76;
  --muted: #B5B8B3;
  --white: #F4F6F2;
  --violet: #9B82F2;
  --violet-deep: #7458D5;
  --violet-soft: rgba(155, 130, 242, .24);
  --open-time: 220ms;
  --close-time: 150ms;
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease-in: cubic-bezier(.55, 0, .9, .45);
  display: block;
  width: 100%;
  color: var(--white);
  font: 400 12px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

*, *::before, *::after { box-sizing: border-box; }

button {
  appearance: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  background: none;
}

button:focus-visible {
  outline: 1px solid rgba(196, 180, 255, .95);
  outline-offset: 2px;
}

.shell {
  position: relative;
  min-height: 366px;
  padding-bottom: 43px;
}

.panel {
  position: absolute;
  inset: 0 0 43px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 14px 14px 12px;
  overflow: hidden;
  border: 1px solid rgba(229, 231, 227, .14);
  border-radius: 14px;
  background:
    radial-gradient(110% 80% at 92% 0%, rgba(94, 80, 142, .12), transparent 42%),
    linear-gradient(180deg, #202126 0%, #1D1E22 100%);
  box-shadow:
    0 1px 1px rgba(0, 0, 0, .28),
    0 4px 9px rgba(0, 0, 0, .18),
    0 14px 36px -15px rgba(0, 0, 0, .88);
  opacity: 0;
  transform: translateY(5px) scale(.985);
  transform-origin: bottom center;
  pointer-events: none;
  transition:
    opacity var(--open-time) var(--ease-out),
    transform var(--open-time) var(--ease-out);
  isolation: isolate;
}

.panel.show {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.panel.no-motion { transition: none !important; }

.panel::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: radial-gradient(80% 60% at 50% 58%, rgba(155, 130, 242, .035), transparent 75%);
  z-index: -1;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 11px;
  min-height: 48px;
}

.copy { min-width: 0; }

.title {
  margin: 2px 0 3px;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -.015em;
  line-height: 1.08;
}

.status {
  margin: 0;
  min-height: 10px;
  max-width: 175px;
  color: rgba(214, 217, 211, .62);
  font-size: 11px;
  letter-spacing: -.015em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 180ms ease;
}

.panel[data-phase="dropping"] .status { color: rgba(214, 217, 211, .7); }
.panel[data-phase="landed"][data-ultra="true"] .status { color: #B9A0FF; }

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.again {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 112px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid rgba(155, 130, 242, .24);
  border-radius: 12px;
  background:
    radial-gradient(circle at 17% 50%, rgba(178, 159, 255, .1), transparent 30%),
    linear-gradient(180deg, rgba(97, 75, 159, .5), rgba(72, 54, 123, .56));
  color: var(--white);
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 1px 1px rgba(0,0,0,.22);
  transition: transform 150ms var(--ease-out), border-color 150ms ease, box-shadow 180ms ease, opacity 150ms ease;
}

.again:hover {
  border-color: rgba(190, 171, 255, .88);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 0 0 1px rgba(155,130,242,.22), 0 0 13px -6px rgba(155,130,242,.7);
}

.again:active { transform: scale(.97); }
.again:disabled { cursor: default; opacity: .52; }
.again:disabled:hover { border-color: rgba(155, 130, 242, .24); box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 1px 2px rgba(0,0,0,.22); }

.action-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--white);
  box-shadow: 0 0 6px rgba(244, 246, 242, .58);
}

.action-label {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -.025em;
}

.again[aria-busy="true"] .action-dot {
  background: #B8A8ED;
  box-shadow: 0 0 6px rgba(155, 130, 242, .35);
}

.bolt {
  width: 10px;
  height: 10px;
  color: #F0EBFF;
}

.bolt svg, .close svg, .trigger svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.bolt svg { fill: currentColor; stroke: none; }

.close {
  position: relative;
  width: 32px;
  height: 32px;
  flex: none;
  color: rgba(222, 224, 219, .58);
  border-radius: 50%;
  cursor: pointer;
  transition: color 150ms ease, background-color 150ms ease, transform 150ms var(--ease-out);
}

.close::before {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 50%;
}

.close:hover { color: var(--white); background: rgba(255,255,255,.06); }
.close:active { transform: scale(.95); }
.close svg { padding: 4px; stroke-width: 1.9; }

.field-area {
  position: relative;
  height: 170px;
  flex: none;
  overflow: hidden;
  border-radius: 12px;
  background:
    radial-gradient(52% 48% at 50% 48%, rgba(51, 50, 60, .2), transparent 100%),
    linear-gradient(180deg, #141517 0%, #15161A 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.025),
    inset 0 5px 14px rgba(0,0,0,.14),
    inset 0 -6px 12px rgba(0,0,0,.08);
}

.peg-board {
  position: absolute;
  inset: 0 0 39px;
  z-index: 2;
  overflow: visible;
}

.flight-path {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  overflow: visible;
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms var(--ease-in);
}

.flight-path.visible {
  opacity: 1;
  transition-duration: 100ms;
  transition-timing-function: var(--ease-out);
}

.flight-path path {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.flight-path-glow {
  stroke: rgba(124, 92, 220, .14);
  stroke-width: 5;
  filter: drop-shadow(0 0 3px rgba(155, 130, 242, .2));
}

.flight-path-core {
  stroke: rgba(194, 180, 255, .42);
  stroke-width: 1;
}

.drop-gate {
  position: absolute;
  left: 50%;
  top: -1px;
  z-index: 3;
  width: 27px;
  height: 17px;
  pointer-events: none;
  transform: translateX(-50%);
}

.drop-gate::before,
.drop-gate::after {
  content: "";
  position: absolute;
  top: 4px;
  width: 13px;
  height: 1px;
  border-radius: 999px;
  background: rgba(157, 159, 155, .28);
  box-shadow: 0 0 3px rgba(155, 130, 242, .08);
}

.drop-gate::before { left: 2px; transform: rotate(43deg); transform-origin: right center; }
.drop-gate::after { right: 2px; transform: rotate(-43deg); transform-origin: left center; }

.peg {
  position: absolute;
  z-index: 1;
  isolation: isolate;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #5E615D, #4A4C49 74%, #3F413F);
  box-shadow: 0 1px 3px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.03);
  transform: translate(-50%, -50%);
  transition: background 180ms var(--ease-out), box-shadow 180ms var(--ease-out);
}

.peg::before,
.peg::after {
  content: "";
  position: absolute;
  z-index: -1;
  border: 1px solid rgba(171, 148, 244, .72);
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
  transform: scale(.62);
}

.peg::before { inset: -6px; }
.peg::after {
  inset: -11px;
  border-color: rgba(136, 111, 215, .42);
}

.peg.rebound {
  animation: peg-rebound 180ms var(--ease-out) both;
}

.peg.rebound::before { animation: peg-halo-inner 280ms var(--ease-out) both; }
.peg.rebound::after { animation: peg-halo-outer 280ms var(--ease-out) 20ms both; }

@keyframes peg-halo-inner {
  0% { opacity: .08; transform: scale(.58); }
  38% { opacity: .78; transform: scale(1.08); }
  100% { opacity: 0; transform: scale(1.18); }
}

@keyframes peg-halo-outer {
  0% { opacity: 0; transform: scale(.48); }
  42% { opacity: .42; transform: scale(1.06); }
  100% { opacity: 0; transform: scale(1.14); }
}

@keyframes peg-rebound {
  0% {
    transform: translate(-50%, -50%) scale(1);
    filter: brightness(1);
    background: radial-gradient(circle at 35% 30%, #5E615D, #4A4C49 74%, #3F413F);
    box-shadow: 0 1px 3px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.03);
  }
  28% {
    transform: translate(
      calc(-50% + var(--peg-kick-x, 0px)),
      calc(-50% + var(--peg-kick-y, 0px))
    ) scale(.95);
    filter: brightness(1.48);
    background: radial-gradient(circle at 35% 30%, #C6B8F8, #9A83DF 58%, #6955A6 100%);
    box-shadow: 0 0 5px rgba(218,208,255,.74), 0 0 9px rgba(155,130,242,.45);
  }
  62% {
    transform: translate(-50%, -50%) scale(1.05);
    filter: brightness(1.18);
    background: radial-gradient(circle at 35% 30%, #9380D0, #68579C 66%, #46404F 100%);
    box-shadow: 0 0 3px rgba(155,130,242,.28);
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
    filter: brightness(1);
    background: radial-gradient(circle at 35% 30%, #5E615D, #4A4C49 74%, #3F413F);
    box-shadow: 0 1px 3px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.03);
  }
}

.pockets {
  position: absolute;
  inset: auto 0 0;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  height: 39px;
  border-top: 1px solid rgba(219, 220, 216, .12);
  background: linear-gradient(180deg, rgba(13, 14, 16, .24), rgba(13, 14, 16, .6));
}

.pocket {
  position: relative;
  min-width: 0;
  border-right: 1px solid rgba(219, 220, 216, .11);
}

.pocket:last-child { border-right: 0; }

.pocket[data-active="true"]::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 24px;
  height: 2px;
  border-radius: 999px 999px 0 0;
  background: var(--violet);
  box-shadow: 0 0 9px rgba(155,130,242,.75), 0 0 17px rgba(155,130,242,.4);
  transform: translateX(-50%);
}

.panel[data-ultra="true"] .pocket[data-active="true"]::after {
  background: #CE89F0;
  box-shadow: 0 0 9px rgba(206,137,240,.92), 0 0 21px rgba(178,111,231,.56);
}

.ball, .trail {
  position: absolute;
  left: var(--ball-x, 50%);
  top: var(--ball-y, 13%);
  width: 16px;
  height: 16px;
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(var(--ball-scale, 1));
  pointer-events: none;
}

.trail {
  z-index: 3;
  opacity: 0;
  border: 1px solid rgba(155, 130, 242, .4);
  box-shadow: 0 0 7px rgba(155,130,242,.34);
  transform: translate(-50%, -50%) rotate(var(--trail-angle, 0deg)) scaleX(var(--trail-stretch, 1)) scale(.76);
  transition: opacity 90ms var(--ease-out);
}

.ball {
  z-index: 5;
  background: radial-gradient(circle at 32% 25%, #FFFFFF 0 17%, #F7F8F4 43%, #D8DBD5 100%);
  box-shadow: 0 1px 2px rgba(0,0,0,.42), 0 0 3px 1px rgba(224, 215, 255, .64);
  transition: transform 180ms var(--ease-out);
}

.ball::before {
  content: "";
  position: absolute;
  inset: -10px;
  z-index: -1;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(235,229,255,.82) 0 15%, rgba(155,130,242,.48) 36%, transparent 72%);
  opacity: .72;
  pointer-events: none;
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
}

.ball::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #656D70;
  box-shadow: inset 0 1px 1px rgba(255,255,255,.35);
  transform: translate(-50%, -50%);
}

.panel[data-phase="dropping"] .ball {
  box-shadow: 0 1px 2px rgba(0,0,0,.42), 0 0 4px 1px rgba(224, 215, 255, .8);
}

.panel[data-phase="dropping"] .ball::before { opacity: 1; transform: scale(1.12); }

.ball.impacting::before { animation: ball-contact 145ms var(--ease-out) both; }

@keyframes ball-contact {
  0% { opacity: 1; transform: scale(1.12); }
  34% { opacity: .68; transform: scale(.82); }
  100% { opacity: 1; transform: scale(1.12); }
}

.ball.landing {
  --ball-scale: 1.04;
}

.ball.landing::before { opacity: .78; transform: scale(1); }

.impact {
  position: absolute;
  left: var(--impact-x, 50%);
  top: var(--impact-y, 20%);
  width: 17px;
  height: 17px;
  z-index: 4;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%) rotate(var(--impact-rotation, 0deg));
}

.impact::before, .impact::after {
  content: "";
  position: absolute;
  top: 50%;
  width: 10px;
  height: 1px;
  border-radius: 999px;
  background: rgba(155,130,242,.95);
  box-shadow: 0 0 5px rgba(155,130,242,.8);
}

.impact::before { right: 52%; transform: rotate(42deg); transform-origin: right center; }
.impact::after { left: 52%; transform: rotate(-42deg); transform-origin: left center; }

.impact.flash { animation: impact-burst 130ms var(--ease-out) both; }

@keyframes impact-burst {
  0% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--impact-rotation, 0deg)) scale(.55); }
  34% { opacity: .92; }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--impact-rotation, 0deg)) scale(1.08); }
}

.landing-glow {
  position: absolute;
  left: var(--burst-x, 50%);
  top: 100%;
  z-index: 2;
  width: 96px;
  height: 66px;
  border-radius: 50% 50% 0 0;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -100%) scale(.58);
  transform-origin: 50% 100%;
  background: radial-gradient(ellipse at 50% 100%, rgba(221,212,255,.9) 0 6%, rgba(155,130,242,.58) 19%, rgba(116,88,213,.28) 43%, transparent 72%);
}

.landing-glow.fire { animation: landing-glow 520ms var(--ease-out) both; }
.panel[data-ultra="true"] .landing-glow {
  background: radial-gradient(ellipse at 50% 100%, rgba(255,232,255,.96) 0 6%, rgba(220,137,250,.66) 20%, rgba(174,98,227,.32) 45%, transparent 74%);
}

@keyframes landing-glow {
  0% { opacity: 0; transform: translate(-50%, -100%) scale(.48); }
  28% { opacity: 1; transform: translate(-50%, -100%) scale(1.04); }
  65% { opacity: .72; transform: translate(-50%, -100%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -100%) scale(.94); }
}

.landing-burst {
  position: absolute;
  left: var(--burst-x, 50%);
  top: 100%;
  z-index: 4;
  width: 0;
  height: 0;
  pointer-events: none;
}

.landing-burst i {
  --angle: 0deg;
  --distance: 22px;
  position: absolute;
  left: -.5px;
  top: -5px;
  width: 1px;
  height: 7px;
  border-radius: 999px;
  opacity: 0;
  background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(155,130,242,.72));
  box-shadow: 0 0 4px rgba(155,130,242,.82);
  transform-origin: 50% 100%;
}

.landing-burst i:nth-child(1) { --angle: -74deg; --distance: 24px; }
.landing-burst i:nth-child(2) { --angle: -52deg; --distance: 19px; }
.landing-burst i:nth-child(3) { --angle: -32deg; --distance: 26px; }
.landing-burst i:nth-child(4) { --angle: -12deg; --distance: 20px; }
.landing-burst i:nth-child(5) { --angle: 12deg; --distance: 23px; }
.landing-burst i:nth-child(6) { --angle: 32deg; --distance: 27px; }
.landing-burst i:nth-child(7) { --angle: 52deg; --distance: 20px; }
.landing-burst i:nth-child(8) { --angle: 74deg; --distance: 25px; }
.landing-burst i:nth-child(even) { animation-delay: 25ms; height: 5px; }
.landing-burst.fire i { animation: landing-spark 470ms var(--ease-out) both; }

.panel[data-ultra="true"] .landing-burst i {
  background: linear-gradient(180deg, #FFFFFF, #E38BFF 72%);
  box-shadow: 0 0 5px rgba(220,129,255,.98), 0 0 10px rgba(174,98,227,.66);
}

@keyframes landing-spark {
  0% { opacity: 0; transform: rotate(var(--angle)) translateY(-4px) scaleY(.35); }
  18% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--angle)) translateY(calc(var(--distance) * -1)) scaleY(.72); }
}

.stop-row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0;
  margin-top: 10px;
}

.stop-label {
  position: relative;
  display: block;
  min-width: 0;
  min-height: 28px;
  padding: 3px 2px 7px;
  color: rgba(194, 197, 191, .48);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: -.02em;
  line-height: 1.04;
  text-align: center;
  user-select: none;
  pointer-events: none;
  transition: color 180ms ease;
}

.stop-label[data-active="true"] {
  color: var(--white);
  font-weight: 650;
}

.stop-label::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 1px;
  width: 0;
  height: 2px;
  border-radius: 999px;
  background: var(--violet);
  box-shadow: 0 0 8px rgba(155,130,242,.76);
  transform: translateX(-50%);
  transition: width 180ms var(--ease-out), opacity 180ms ease;
  opacity: 0;
}

.stop-label[data-active="true"]::after { width: 20px; opacity: 1; }

.slider {
  position: relative;
  --thumb-size: 32px;
  --thumb-radius: 16px;
  flex: none;
  margin-top: 11px;
  height: 28px;
  pointer-events: none;
  user-select: none;
}

.rail {
  position: absolute;
  inset: 0;
  overflow: visible;
  border-radius: 999px;
  background: linear-gradient(180deg, #37383C, #2E3034);
  box-shadow: inset 0 1px 3px rgba(0,0,0,.44), inset 0 0 0 1px rgba(255,255,255,.02);
}

.fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 1;
  width: min(100%, calc(var(--position, 41.667) * 1% + var(--thumb-radius)));
  border-radius: inherit;
  background: linear-gradient(90deg, #765BD2 0%, #9D88EC 100%);
  box-shadow: 0 0 9px rgba(155,130,242,.19);
  transition: width 230ms var(--ease-out);
}

.panel[data-ultra="true"] .fill {
  background: linear-gradient(90deg, #765BD2 0%, #A879E7 72%, #D28AF2 100%);
  box-shadow: 0 0 10px rgba(180,111,231,.28), 0 0 19px -7px rgba(220,141,250,.58);
}

.rail-dots {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

.rail-dot {
  position: absolute;
  left: var(--dot-position);
  top: 50%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(213, 216, 210, .56);
  transform: translate(-50%, -50%);
}

.thumb {
  position: absolute;
  left: calc(var(--position, 41.667) * 1%);
  top: 50%;
  z-index: 3;
  width: var(--thumb-size);
  height: var(--thumb-size);
  border-radius: 50%;
  background: radial-gradient(circle at 31% 25%, #FFFFFF 0 18%, #F4F6F2 58%, #D8DCD6 100%);
  box-shadow: 0 1px 2px rgba(0,0,0,.34), 0 3px 7px rgba(0,0,0,.26), 0 0 0 1px rgba(0,0,0,.1);
  transform: translate(-50%, -50%);
  transition: left 230ms var(--ease-out), transform 140ms var(--ease-out);
}

.thumb::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: inherit;
  box-shadow: 0 0 0 1px rgba(155,130,242,.22), 0 0 8px -3px rgba(155,130,242,.7);
  opacity: .35;
  transition: opacity 160ms ease;
}

.panel[data-ultra="true"] .thumb::after {
  box-shadow: 0 0 0 1px rgba(211,139,244,.62), 0 0 11px rgba(197,119,238,.72), 0 0 21px rgba(170,93,220,.36);
  opacity: .9;
}

.trigger {
  position: absolute;
  left: 50%;
  bottom: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: min(225px, 76%);
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid rgba(255,255,255,.02);
  border-radius: 999px;
  background: linear-gradient(180deg, #24262A, #1D1F22);
  color: rgba(231, 233, 228, .84);
  cursor: pointer;
  transform: translateX(-50%);
  box-shadow: 0 1px 1px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.02);
  transition: transform 150ms var(--ease-out), background-color 150ms ease, color 150ms ease;
}

.trigger:hover { background: #292B30; color: var(--white); }
.trigger:active { transform: translateX(-50%) scale(.98); }
.trigger-main { font-size: 11px; font-weight: 500; letter-spacing: -.02em; }
.trigger-choice { color: rgba(207, 210, 204, .62); font-size: 10px; }
.trigger-chevron {
  width: 9px;
  height: 9px;
  color: rgba(205, 208, 202, .48);
  transition: transform 180ms var(--ease-out);
}
.trigger svg { stroke-width: 1.8; }
:host([open]) .trigger-chevron { transform: rotate(180deg); }

@media (max-width: 440px) {
  .shell { min-height: 337px; padding-bottom: 40px; }
  .panel { inset: 0 0 40px; padding: 12px 10px 10px; }
  .header { min-height: 47px; gap: 8px; }
  .status { max-width: 135px; }
  .header-actions { gap: 4px; }
  .again { width: 108px; }
  .field-area { height: 148px; }
  .pockets { height: 34px; }
  .peg-board { inset: 0 0 34px; }
  .stop-row { margin-top: 8px; }
  .stop-label { min-height: 26px; font-size: 9px; padding-bottom: 6px; }
  .slider { margin-top: 8px; height: 26px; --thumb-size: 30px; --thumb-radius: 15px; }
  .trigger { width: min(225px, 88%); min-height: 36px; }
}

@media (prefers-reduced-motion: reduce) {
  .panel, .again, .close, .status, .stop-label, .stop-label::after, .fill, .thumb, .thumb::after, .trigger, .trigger-chevron, .trail { transition: none !important; }
  .flight-path { display: none !important; }
  .peg.rebound, .peg.rebound::before, .peg.rebound::after, .ball.impacting::before { animation: none !important; }
  .impact.flash, .landing-burst.fire i, .landing-glow.fire { animation: none !important; opacity: 0 !important; }
}
`;

const template = `
  <div class="shell">
    <section class="panel" role="dialog" aria-label="Reasoning effort" aria-hidden="true" data-phase="landed">
      <header class="header">
        <div class="copy">
          <h1 class="title">Reasoning effort</h1>
          <p class="status" aria-live="polite">Landed on Medium. Thinking effort set.</p>
        </div>
        <div class="header-actions">
          <button class="again" type="button" aria-label="Run the reasoning effort again" aria-busy="false">
            <span class="action-dot" aria-hidden="true"></span>
            <span class="action-label">Again</span>
            <span class="bolt" aria-hidden="true">${boltIcon}</span>
          </button>
          <button class="close" type="button" aria-label="Close reasoning effort">${closeIcon}</button>
        </div>
      </header>

      <div class="field-area" aria-hidden="true">
        <div class="peg-board"></div>
        <svg class="flight-path" preserveAspectRatio="none" aria-hidden="true">
          <path class="flight-path-glow"></path>
          <path class="flight-path-core"></path>
        </svg>
        <div class="pockets"></div>
        <span class="drop-gate"></span>
        <span class="trail"></span>
        <span class="impact"></span>
        <span class="landing-glow"></span>
        <span class="landing-burst"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
        <span class="ball"></span>
      </div>

      <div class="stop-row" aria-hidden="true"></div>

      <div class="slider" aria-hidden="true">
        <div class="rail" aria-hidden="true">
          <div class="fill"></div>
          <div class="rail-dots"></div>
          <span class="thumb"></span>
        </div>
      </div>
    </section>

    <button class="trigger" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Open reasoning effort">
      <span class="trigger-main">5.6 Sol</span>
      <span class="trigger-choice">Medium</span>
      <span class="trigger-chevron" aria-hidden="true">${chevronIcon}</span>
    </button>
  </div>`;

class BallModelPicker extends HTMLElement {
  static observedAttributes = ['open'];

  #selected = INITIAL_STOP;
  #phase = 'landed';
  #raf = 0;
  #landingTimer = 0;
  #animationToken = 0;
  #connected = false;
  #els = {};

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${css}</style>${template}`;

    this.#els = {
      panel: shadow.querySelector('.panel'),
      status: shadow.querySelector('.status'),
      action: shadow.querySelector('.again'),
      actionLabel: shadow.querySelector('.action-label'),
      close: shadow.querySelector('.close'),
      field: shadow.querySelector('.field-area'),
      pegBoard: shadow.querySelector('.peg-board'),
      flightPath: shadow.querySelector('.flight-path'),
      flightPathGlow: shadow.querySelector('.flight-path-glow'),
      flightPathCore: shadow.querySelector('.flight-path-core'),
      pockets: shadow.querySelector('.pockets'),
      ball: shadow.querySelector('.ball'),
      trail: shadow.querySelector('.trail'),
      impact: shadow.querySelector('.impact'),
      landingGlow: shadow.querySelector('.landing-glow'),
      landingBurst: shadow.querySelector('.landing-burst'),
      stopRow: shadow.querySelector('.stop-row'),
      slider: shadow.querySelector('.slider'),
      rail: shadow.querySelector('.rail'),
      fill: shadow.querySelector('.fill'),
      railDots: shadow.querySelector('.rail-dots'),
      thumb: shadow.querySelector('.thumb'),
      trigger: shadow.querySelector('.trigger'),
      triggerChoice: shadow.querySelector('.trigger-choice'),
    };

    this.#buildBoard();
    this.#bindEvents();
  }

  connectedCallback() {
    this.#connected = true;
    this.#syncOpen(false);
    this.#render();
  }

  disconnectedCallback() {
    this.#connected = false;
    this.#cancelAnimation();
  }

  attributeChangedCallback(name) {
    if (name === 'open' && this.#connected) this.#syncOpen(true);
  }

  get value() {
    return { index: this.#selected, id: STOPS[this.#selected].id, label: STOPS[this.#selected].label };
  }

  #buildBoard() {
    const rows = [5, 6, 5, 6, 5];
    rows.forEach((count, rowIndex) => {
      const positions = count === 5 ? [16.667, 33.333, 50, 66.667, 83.333] : [8.333, 25, 41.667, 58.333, 75, 91.667];
      positions.forEach((left) => {
        const peg = document.createElement('span');
        peg.className = 'peg';
        peg.style.left = `${left}%`;
        peg.style.top = `${10 + rowIndex * 18}%`;
        this.#els.pegBoard.append(peg);
      });
    });

    STOPS.forEach((stop, index) => {
      const pocket = document.createElement('span');
      pocket.className = 'pocket';
      pocket.dataset.index = String(index);
      this.#els.pockets.append(pocket);

      const label = document.createElement('span');
      label.className = 'stop-label';
      label.dataset.index = String(index);
      label.innerHTML = stop.label === 'Extra High' ? 'Extra<br>High' : stop.label;
      this.#els.stopRow.append(label);

      const dot = document.createElement('span');
      dot.className = 'rail-dot';
      dot.style.setProperty('--dot-position', `${STOP_POSITIONS[index]}%`);
      this.#els.railDots.append(dot);
    });
  }

  #bindEvents() {
    this.#els.action.addEventListener('click', () => {
      if (this.#phase === 'dropping') return;
      this.#startDrop();
    });

    this.#els.close.addEventListener('click', () => this.removeAttribute('open'));
    this.#els.trigger.addEventListener('click', () => this.toggleAttribute('open'));
  }

  #syncOpen(animate) {
    const open = this.hasAttribute('open');
    const { panel, trigger } = this.#els;
    panel.setAttribute('aria-hidden', String(!open));
    panel.toggleAttribute('inert', !open);
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? 'Collapse reasoning effort' : 'Open reasoning effort');

    if (open) {
      if (!animate) panel.classList.add('no-motion');
      if (animate && !this.#prefersReducedMotion()) {
        panel.classList.remove('show');
        void panel.offsetWidth;
      }
      panel.classList.add('show');
      if (!animate) requestAnimationFrame(() => panel.classList.remove('no-motion'));
    } else {
      panel.classList.remove('show');
    }
  }

  #render() {
    const { panel, status, action, actionLabel, fill, thumb, triggerChoice } = this.#els;
    const stop = STOPS[this.#selected];
    panel.dataset.phase = this.#phase;
    panel.dataset.ultra = String(this.#selected === STOPS.length - 1);
    if (this.#phase === 'dropping') {
      status.textContent = 'Ball in play...';
    } else if (this.#selected === STOPS.length - 1) {
      status.textContent = 'Consumes usage limits faster';
    } else {
      status.textContent = `Landed on ${stop.label}. Thinking effort set.`;
    }
    actionLabel.textContent = this.#phase === 'dropping' ? 'Dropping' : 'Again';
    action.disabled = this.#phase === 'dropping';
    action.setAttribute('aria-busy', String(this.#phase === 'dropping'));
    fill.style.setProperty('--position', String(STOP_POSITIONS[this.#selected]));
    thumb.style.setProperty('--position', String(STOP_POSITIONS[this.#selected]));
    triggerChoice.textContent = this.#phase === 'dropping' ? 'Choosing...' : stop.label;

    this.#els.stopRow.querySelectorAll('.stop-label').forEach((label, index) => {
      const active = index === this.#selected;
      label.dataset.active = String(active);
      this.#els.pockets.children[index].dataset.active = String(active);
    });

    if (this.#phase !== 'dropping') this.#setBall(STOP_POSITIONS[this.#selected], 89, 1);
  }

  #emitChange() {
    this.dispatchEvent(new CustomEvent('change', {
      bubbles: true,
      composed: true,
      detail: { ...this.value, phase: this.#phase },
    }));
  }

  #startDrop() {
    if (!this.hasAttribute('open')) this.setAttribute('open', '');
    this.#cancelAnimation();
    this.#phase = 'dropping';
    this.#render();

    if (this.#prefersReducedMotion()) {
      const route = createPlinkoRoute();
      this.#selected = route.result;
      this.#phase = 'landed';
      this.#render();
      this.#emitChange();
      return;
    }

    const token = ++this.#animationToken;
    const motion = this.#createMotionState();
    const history = [];
    const trace = [];
    let lastFrame = null;
    this.#els.ball.classList.remove('landing');
    this.#els.ball.style.transition = 'none';
    this.#els.trail.style.opacity = '0';
    this.#prepareFlightPath(motion);
    this.#moveBall(this.#toPercentX(motion, motion.x), this.#toPercentY(motion, motion.y), 1);

    const frame = (now) => {
      if (token !== this.#animationToken) return;
      if (lastFrame === null) lastFrame = now;
      const deltaSeconds = Math.max(0, Math.min(.05, (now - lastFrame) / 1000));
      lastFrame = now;
      motion.accumulator = Math.min(.08, motion.accumulator + deltaSeconds);
      let landed = false;

      while (motion.accumulator >= motion.fixedStep && !landed) {
        const events = stepPinball(motion, motion.fixedStep);
        events.impacts.forEach((impact) => {
          this.#appendTracePoint(trace, impact.x, impact.y, now, .5);
          this.#showPegImpact(motion, impact);
        });
        landed = events.landed;
        motion.accumulator -= motion.fixedStep;
      }

      const x = this.#toPercentX(motion, motion.x);
      const y = this.#toPercentY(motion, motion.y);
      this.#moveBall(x, y, 1);
      this.#updateFlightPath(trace, motion.x, motion.y, now);
      history.push({ time: now, x, y });
      const ghostTime = now - 72;
      while (history.length > 2 && history[1].time <= ghostTime) history.shift();
      const ghost = history[0];
      if (ghost) {
        const angle = Math.atan2(motion.vy, motion.vx) * 180 / Math.PI;
        const stretch = 1 + Math.min(.65, Math.hypot(motion.vx, motion.vy) / 390);
        this.#els.trail.style.left = `${ghost.x}%`;
        this.#els.trail.style.top = `${ghost.y}%`;
        this.#els.trail.style.setProperty('--trail-angle', `${angle}deg`);
        this.#els.trail.style.setProperty('--trail-stretch', stretch.toFixed(3));
        this.#els.trail.style.opacity = history.length > 1 && !landed ? '.34' : '.05';
      }

      if (!landed) {
        this.#raf = requestAnimationFrame(frame);
      } else {
        this.#raf = 0;
        this.#finishDrop(motion.target, token);
      }
    };

    this.#raf = requestAnimationFrame(frame);
  }

  #createMotionState() {
    const fieldRect = this.#els.field.getBoundingClientRect();
    const pocketRect = this.#els.pockets.getBoundingClientRect();
    const ballRect = this.#els.ball.getBoundingClientRect();
    const pegs = [...this.#els.pegBoard.querySelectorAll('.peg')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        element,
        x: rect.left + rect.width / 2 - fieldRect.left,
        y: rect.top + rect.height / 2 - fieldRect.top,
        radius: rect.width / 2,
      };
    });

    return createPinballState({
      width: fieldRect.width,
      height: fieldRect.height,
      pocketTop: pocketRect.top - fieldRect.top,
      pegs,
      options: { ballRadius: ballRect.width / 2 },
    });
  }

  #showPegImpact(motion, impact) {
    const rotation = Math.atan2(impact.ny, impact.nx) * 180 / Math.PI;
    this.#flashImpact(
      this.#toPercentX(motion, impact.x),
      this.#toPercentY(motion, impact.y),
      rotation,
    );

    const peg = impact.peg.element;
    const kick = Math.min(1.45, .65 + impact.speed / 260);
    peg.style.setProperty('--peg-kick-x', `${(-impact.nx * kick).toFixed(2)}px`);
    peg.style.setProperty('--peg-kick-y', `${(-impact.ny * kick).toFixed(2)}px`);
    peg.classList.remove('rebound');
    void peg.offsetWidth;
    peg.classList.add('rebound');

    this.#els.ball.classList.remove('impacting');
    void this.#els.ball.offsetWidth;
    this.#els.ball.classList.add('impacting');
  }

  #toPercentX(motion, x) {
    return x / motion.width * 100;
  }

  #toPercentY(motion, y) {
    return y / motion.height * 100;
  }

  #prepareFlightPath(motion) {
    const { flightPath, flightPathGlow, flightPathCore } = this.#els;
    flightPath.setAttribute('viewBox', `0 0 ${motion.width} ${motion.height}`);
    flightPathGlow.setAttribute('d', '');
    flightPathCore.setAttribute('d', '');
    flightPath.classList.add('visible');
  }

  #appendTracePoint(trace, x, y, time, minimumDistance = 1.35) {
    const last = trace.at(-1);
    if (!last || Math.hypot(x - last.x, y - last.y) >= minimumDistance) {
      trace.push({ x, y, time });
    }
  }

  #updateFlightPath(trace, x, y, now) {
    this.#appendTracePoint(trace, x, y, now);
    const cutoff = now - 90;
    while (trace.length > 2 && trace[1].time < cutoff) trace.shift();
    const points = trace.at(-1)?.x === x && trace.at(-1)?.y === y
      ? trace
      : [...trace, { x, y, time: now }];
    const d = points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    ).join(' ');
    this.#els.flightPathGlow.setAttribute('d', d);
    this.#els.flightPathCore.setAttribute('d', d);
  }

  #finishDrop(target, token) {
    if (token !== this.#animationToken) return;
    const x = STOP_POSITIONS[target];
    this.#els.ball.style.transition = '';
    this.#selected = target;
    this.#phase = 'landed';
    this.#render();
    this.#setBall(x, 89, 1.04);
    this.#els.ball.classList.remove('impacting');
    this.#els.ball.classList.add('landing');
    this.#els.trail.style.opacity = '0';
    this.#els.flightPath.classList.remove('visible');
    this.#els.flightPathGlow.setAttribute('d', '');
    this.#els.flightPathCore.setAttribute('d', '');
    this.#els.landingGlow.style.setProperty('--burst-x', `${x}%`);
    this.#els.landingGlow.classList.remove('fire');
    void this.#els.landingGlow.offsetWidth;
    this.#els.landingGlow.classList.add('fire');
    this.#els.landingBurst.style.setProperty('--burst-x', `${x}%`);
    this.#els.landingBurst.classList.remove('fire');
    void this.#els.landingBurst.offsetWidth;
    this.#els.landingBurst.classList.add('fire');
    this.#emitChange();
    this.#landingTimer = window.setTimeout(() => {
      if (token !== this.#animationToken) return;
      this.#els.ball.classList.remove('landing');
      this.#els.landingGlow.classList.remove('fire');
      this.#els.landingBurst.classList.remove('fire');
      this.#els.pegBoard.querySelectorAll('.peg.rebound').forEach((peg) => peg.classList.remove('rebound'));
      this.#els.ball.style.transition = '';
      this.#landingTimer = 0;
    }, 520);
  }

  #flashImpact(x, y, rotation) {
    const impact = this.#els.impact;
    impact.style.setProperty('--impact-x', `${x}%`);
    impact.style.setProperty('--impact-y', `${y}%`);
    impact.style.setProperty('--impact-rotation', `${rotation}deg`);
    impact.classList.remove('flash');
    void impact.offsetWidth;
    impact.classList.add('flash');
  }

  #setBall(x, y, scale) {
    this.#els.ball.style.setProperty('--ball-x', `${x}%`);
    this.#els.ball.style.setProperty('--ball-y', `${y}%`);
    this.#els.ball.style.setProperty('--ball-scale', String(scale));
  }

  #moveBall(x, y, scale) {
    this.#els.ball.style.setProperty('--ball-x', `${x}%`);
    this.#els.ball.style.setProperty('--ball-y', `${y}%`);
    this.#els.ball.style.setProperty('--ball-scale', String(scale));
  }

  #cancelAnimation() {
    this.#animationToken += 1;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    if (this.#landingTimer) clearTimeout(this.#landingTimer);
    this.#raf = 0;
    this.#landingTimer = 0;
    this.#els.trail.style.opacity = '0';
    this.#els.flightPath.classList.remove('visible');
    this.#els.flightPathGlow.setAttribute('d', '');
    this.#els.flightPathCore.setAttribute('d', '');
    this.#els.ball.classList.remove('landing', 'impacting');
    this.#els.pegBoard.querySelectorAll('.peg.rebound').forEach((peg) => peg.classList.remove('rebound'));
    this.#els.landingGlow.classList.remove('fire');
    this.#els.landingBurst.classList.remove('fire');
    this.#els.ball.style.transition = '';
  }

  #prefersReducedMotion() {
    return this.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }
}

if (!customElements.get('ball-model-picker')) {
  customElements.define('ball-model-picker', BallModelPicker);
}

export { BallModelPicker };
