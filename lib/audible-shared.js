export const AUDIBLE_DEVICE_TYPE = "A10KISP2GWF0E4";
export const AUDIBLE_API_USER_AGENT = "Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64 Build/UPB5.230623.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.5672.136 Mobile Safari/537.36";
export const AUDIBLE_DOWNLOAD_USER_AGENT = "com.audible.playersdk.player/3.96.1 (Linux;Android 14) AndroidXMedia3/1.3.0";

export const LOCALES = {
  us: { name: "us", countryCode: "us", topDomain: "com", marketPlaceId: "AF2M0KC94RCEA", language: "en-US" },
  uk: { name: "uk", countryCode: "uk", topDomain: "co.uk", marketPlaceId: "A2I9A3Q2GNFNGQ", language: "en-GB" },
  au: { name: "au", countryCode: "au", topDomain: "com.au", marketPlaceId: "AN7EY7DTAW63G", language: "en-AU" },
  australia: { name: "au", countryCode: "au", topDomain: "com.au", marketPlaceId: "AN7EY7DTAW63G", language: "en-AU" },
  br: { name: "br", countryCode: "br", topDomain: "com.br", marketPlaceId: "A10J1VAYUDTYRN", language: "pt-BR" },
  ca: { name: "ca", countryCode: "ca", topDomain: "ca", marketPlaceId: "A2CQZ5RBY40XE", language: "en-CA" },
  de: { name: "de", countryCode: "de", topDomain: "de", marketPlaceId: "AN7V1F1VY261K", language: "de-DE" },
  es: { name: "es", countryCode: "es", topDomain: "es", marketPlaceId: "ALMIKO4SZCSAR", language: "es-ES" },
  fr: { name: "fr", countryCode: "fr", topDomain: "fr", marketPlaceId: "A2728XDNODOQ8T", language: "fr-FR" },
  in: { name: "in", countryCode: "in", topDomain: "in", marketPlaceId: "AJO3FBRUE6J4S", language: "en-IN" },
  it: { name: "it", countryCode: "it", topDomain: "it", marketPlaceId: "A2N7FU2W2BU2ZC", language: "it-IT" },
  jp: { name: "jp", countryCode: "jp", topDomain: "co.jp", marketPlaceId: "A1QAP3MOU4173J", language: "ja-JP" },
};

/** @typedef {{ name: string, countryCode: string, topDomain: string, marketPlaceId: string, language: string }} AudibleLocale */

/**
 * @param {string | undefined | null} name
 * @returns {AudibleLocale}
 */
export function getLocale(name = "uk") {
  return LOCALES[String(name || "uk").toLowerCase()] || LOCALES.uk;
}

/**
 * @param {AudibleLocale} locale
 * @returns {string}
 */
export function audibleApiBase(locale) {
  return `https://api.audible.${locale.topDomain}`;
}

export const LIBRARY_PAGE_SIZE = 50;
export const LIBRARY_RESPONSE_GROUPS = "contributors,media,product_attrs,product_desc,product_extended_attrs,series";

/**
 * @param {number} [page]
 * @param {number} [pageSize]
 * @returns {string}
 */
export function buildLibraryPath(page = 1, pageSize = LIBRARY_PAGE_SIZE) {
  return `/1.0/library?num_results=${pageSize}&page=${page}&response_groups=${encodeURIComponent(LIBRARY_RESPONSE_GROUPS)}&image_sizes=500%2C300`;
}

/**
 * @param {string} asin
 * @returns {string}
 */
export function buildLicensePath(asin) {
  return `/1.0/content/${asin}/licenserequest`;
}

export function buildLicenseRequestBody() {
  return {
    supported_media_features: {
      drm_types: ["Adrm", "Mpeg"],
      codecs: ["mp4a.40.2"],
      chapter_titles_type: "Tree",
      previews: false,
      catalog_samples: false,
    },
    spatial: false,
    consumption_type: "Download",
    tenant_id: "Audible",
    quality: "High",
    response_groups: "last_position_heard,pdf_url,content_reference,chapter_info",
  };
}
