// What we can honestly tell about an open or click from the request alone.
// Pure (unit-tested). Never guesses: anything we can't recognise is "Unknown".

export type DeviceType = "Mobile" | "Desktop" | "Webmail" | "Unknown";

export interface UserAgentInfo {
  device: DeviceType;
  /** Email app (for opens) or browser (for clicks), e.g. "Apple Mail", "Gmail", "Chrome". "Unknown" when unclear. */
  client: string;
}

const has = (ua: string, re: RegExp) => re.test(ua);

/** Apple Mail Privacy Protection fetches images through a proxy that sends just "Mozilla/5.0". */
export function isPrivacyProxyUserAgent(userAgent: string | null | undefined): boolean {
  return (userAgent ?? "").trim() === "Mozilla/5.0";
}

export function classifyUserAgent(userAgent: string | null | undefined): UserAgentInfo {
  const ua = (userAgent ?? "").trim();
  if (!ua) return { device: "Unknown", client: "Unknown" };
  if (isPrivacyProxyUserAgent(ua)) return { device: "Unknown", client: "Apple Mail (privacy)" };

  // Webmail image proxies: the person opened the email in their browser/app, device unknown.
  if (has(ua, /GoogleImageProxy|ggpht\.com/i)) return { device: "Webmail", client: "Gmail" };
  if (has(ua, /YahooMailProxy/i)) return { device: "Webmail", client: "Yahoo Mail" };

  const mobile = has(ua, /iPhone|iPod|Android|Mobile|Windows Phone|BlackBerry|iPad|Tablet/i);
  const desktopOs = has(ua, /Windows NT|Macintosh|Mac OS X|X11|Linux|CrOS/i);
  const device: DeviceType = mobile ? "Mobile" : desktopOs ? "Desktop" : "Unknown";

  let client = "Unknown";
  if (has(ua, /Microsoft Outlook|MSOffice|Microsoft Office|Outlook-iOS|Outlook-Android/i)) client = "Outlook";
  else if (has(ua, /Thunderbird/i)) client = "Thunderbird";
  else if (has(ua, /SamsungEmail/i)) client = "Samsung Email";
  else if (has(ua, /Edg\//)) client = "Edge";
  else if (has(ua, /SamsungBrowser/i)) client = "Samsung Internet";
  else if (has(ua, /Firefox\//)) client = "Firefox";
  else if (has(ua, /Chrome\/|CriOS\//)) client = "Chrome";
  else if (has(ua, /Version\/[\d.]+.*Safari\//)) client = "Safari";
  // Apple's mail apps use WebKit without a "Safari" token.
  else if (has(ua, /AppleWebKit\//) && has(ua, /iPhone|iPad|iPod|Macintosh/) && !has(ua, /Safari\//)) {
    client = "Apple Mail";
  }
  return { device, client };
}

/** Clicks this soon after the email was accepted are almost always a security scanner. */
export const BOT_CLICK_WINDOW_MS = 2_000;

export interface HitFlags {
  /** Probably a machine: a self-identifying scanner/crawler, or a hit within 2 s of sending. */
  suspectedBot: boolean;
  /** Apple Mail Privacy Protection loaded the images (not necessarily a person reading). */
  privacyProxy: boolean;
}

export function classifyHit(input: {
  userAgent: string | null | undefined;
  /** isBotUserAgent(userAgent) from the sending engine. */
  knownBot: boolean;
  sentAt: Date | null | undefined;
  now: Date;
}): HitFlags {
  const tooFast = input.sentAt ? input.now.getTime() - input.sentAt.getTime() < BOT_CLICK_WINDOW_MS : false;
  return {
    suspectedBot: input.knownBot || tooFast,
    privacyProxy: isPrivacyProxyUserAgent(input.userAgent),
  };
}

// Country headers set by common hosting proxies / CDNs. Only trusted when
// present and a plain ISO 3166 code: we never guess from the IP ourselves.
const COUNTRY_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "cloudfront-viewer-country", "x-country-code"];
const NOT_A_COUNTRY = new Set(["XX", "T1", "ZZ", "A1", "A2", "O1", "EU", "AP"]);

export function countryFromHeaders(headers: { get(name: string): string | null }): string | null {
  for (const name of COUNTRY_HEADERS) {
    const value = headers.get(name)?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value) && !NOT_A_COUNTRY.has(value)) return value;
  }
  return null;
}

/** "GB" -> "United Kingdom" (falls back to the code). */
export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  try {
    return new Intl.DisplayNames(["en-GB"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Keep stored user agents bounded. */
export function trimUserAgent(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? "").trim();
  return ua ? ua.slice(0, 512) : null;
}
