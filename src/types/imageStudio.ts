export type AspectRatioId = '1:1' | '3:4' | '4:3';

export interface AspectRatioOption {
  id: AspectRatioId;
  label: string;
  width: number;
  height: number;
}

export interface StudioImageItem {
  id: string;
  url: string;
  mimeType: string;
  prompt: string;
  aspectRatio: AspectRatioId;
  width: number;
  height: number;
  seed: number;
  createdAt: number;
}

export interface StudioQueueSlot {
  slotId: string;
  index: number;
  total: number;
  prompt: string;
  aspectRatio: AspectRatioId;
  width: number;
  height: number;
  seed: number;
  status: 'queued' | 'waiting' | 'generating' | 'error';
  waitSeconds?: number;
  errorMessage?: string;
}

export const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = [
  { id: '1:1', label: 'Square', width: 768, height: 768 },
  { id: '3:4', label: 'Portrait', width: 576, height: 768 },
  { id: '4:3', label: 'Landscape', width: 768, height: 576 },
];
