// A short, readable name for a browser, from its user agent, for Profile's device lists:
// "<device> · <browser>". Device: iPhone, iPad, Android phone, Android tablet, Mac, Windows PC,
// Linux PC, else "Device". Browser: Safari, Chrome, Firefox, Edge, Samsung Internet, else
// "Browser" (Chrome on iOS reports CriOS, Firefox FxiOS, Edge EdgiOS). An iPad that reports
// itself as a Mac reads as Mac. At most 60 characters. Examples:
//   iPhone Safari → "iPhone · Safari"; Pixel Chrome → "Android phone · Chrome"; '' → "Device · Browser".

/** The longest label (DeviceInfo.label). */
export const DEVICE_LABEL_MAX = 60;

function deviceOf(ua: string): string {
  if (/\b(iPhone|iPod)\b/.test(ua)) return 'iPhone';
  if (/\biPad\b/.test(ua)) return 'iPad';
  if (/\bAndroid\b/i.test(ua)) return /\bMobile\b/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/\b(Macintosh|Mac OS X)\b/.test(ua)) return 'Mac';
  if (/\bWindows\b/.test(ua)) return 'Windows PC';
  if (/\b(Linux|X11)\b/.test(ua)) return 'Linux PC';
  return 'Device';
}

function browserOf(ua: string): string {
  // Order matters: most browsers also say "Safari", and Edge and Samsung Internet also say "Chrome".
  if (/\b(Edg|Edge|EdgA|EdgiOS)\//.test(ua)) return 'Edge';
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/\b(Firefox|FxiOS)\//.test(ua)) return 'Firefox';
  if (/\b(Chrome|HeadlessChrome|CriOS|Chromium)\//.test(ua)) return 'Chrome';
  if (/\b(Safari|AppleWebKit)\//.test(ua)) return 'Safari';
  return 'Browser';
}

export function deviceLabel(userAgent: string | undefined): string {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  return Array.from(`${deviceOf(ua)} · ${browserOf(ua)}`).slice(0, DEVICE_LABEL_MAX).join('');
}
