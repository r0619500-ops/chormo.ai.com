import { DigitalHeartCore } from './DigitalHeartCore';

export type VoiceOrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface VoiceOrbCanvasProps {
  state: VoiceOrbState;
  audioLevelRef: { current: number };
  onOrbClick?: () => void;
}

export function VoiceOrbCanvas({ state, audioLevelRef, onOrbClick }: VoiceOrbCanvasProps) {
  const mappedState = state === 'speaking' ? 'responding' : state;

  return (
    <DigitalHeartCore
      state={mappedState}
      audioLevelRef={audioLevelRef}
      size="voice"
      onClick={onOrbClick}
      ariaLabel="Interact with CHORMO AI Digital Core"
    />
  );
}
