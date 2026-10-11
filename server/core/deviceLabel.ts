// A short, readable name for a browser, from its user agent, for Profile's device lists:
// "<device> · <browser>". Device: iPhone, iPad, Android phone, Android tablet, Mac, Windows PC,
// Linux PC, else "Device". Browser: Safari, Chrome, Firefox, Edge, Samsung Internet, else
// "Browser" (Chrome on iOS reports CriOS, Firefox FxiOS, Edge EdgiOS). An iPad that reports
// itself as a Mac reads as Mac. At most 60 characters. Examples:
//   iPhone Safari → "iPhone · Safari"; Pixel Chrome → "Android phone · Chrome"; '' → "Device · Browser".
//
// SKELETON: not implemented yet.

export function deviceLabel(_userAgent: string | undefined): string {
  throw new Error('deviceLabel: not implemented yet');
}
