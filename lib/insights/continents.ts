/**
 * ISO 3166-1 alpha-2 → continent, for rolling a travel history up to
 * "how much of my travelling was Europe?".
 *
 * Kept as a hand-checked constant rather than derived from the bundled
 * country outlines, which carry only geometry and a code. The seven-continent
 * scheme is the everyday one; transcontinental countries sit where their
 * bulk of travel destinations sits (Russia and Turkey with Europe, the
 * Caucasus with Asia), and island territories sit with the continent that
 * claims them on an ordinary map.
 */

const BY_CONTINENT: Record<string, string> = {
  Africa:
    "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE " +
    "KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST " +
    "SZ TD TG TN TZ UG YT ZA ZM ZW",
  Antarctica: "AQ BV GS HM TF",
  Asia:
    "AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IO IQ IR JO JP KG KH KP KR " +
    "KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TW " +
    "UZ VN YE",
  Europe:
    "AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE " +
    "IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK " +
    "SM TR UA VA XK",
  "North America":
    "AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY " +
    "LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI",
  Oceania:
    "AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV " +
    "UM VU WF WS",
  "South America": "AR BO BR CL CO EC FK GF GY PE PY SR UY VE",
};

const CONTINENT_OF: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [continent, codes] of Object.entries(BY_CONTINENT)) {
    for (const code of codes.split(" ")) map.set(code, continent);
  }
  return map;
})();

/** Where a heading with no better answer files a place. */
export const UNKNOWN_CONTINENT = "Elsewhere";

/**
 * The continent behind a country code, or "Elsewhere" — a row typed by hand
 * can carry no code at all, and it still deserves a shelf rather than a
 * crash or an exclusion.
 */
export function continentOf(countryCode: string | undefined): string {
  const code = countryCode?.trim().toUpperCase();
  if (!code) return UNKNOWN_CONTINENT;
  return CONTINENT_OF.get(code) ?? UNKNOWN_CONTINENT;
}
