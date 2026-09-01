// Shared color math for the "lamp heating up" visual — LED color runs dim
// red → orange → blue (no white) as progress climbs from 0 to 100. Used by
// both the one-time boot LoadingScreen and the looping LampBulb background.
export function getLampColor(p: number): string {
  if (p < 30) return `hsl(0, 85%, ${8 + p * 0.8}%)`;
  if (p < 65) return `hsl(${(p - 30) * 0.86}, 95%, ${32 + (p - 30) * 0.86}%)`;
  return `hsl(${30 + (p - 65) * 5.14}, ${95 - (p - 65) * 0.14}%, ${62 + (p - 65) * 0.09}%)`;
}

export function getLampFilamentColor(p: number): string {
  if (p < 20) return `hsl(0, 100%, ${15 + p * 1.5}%)`;
  if (p < 60) return `hsl(${(p - 20) * 0.75}, 100%, ${45 + (p - 20) * 0.5}%)`;
  return `hsl(${30 + (p - 60) * 4.5}, ${100 - (p - 60) * 0.75}%, ${65 + (p - 60) * 0.1}%)`;
}
