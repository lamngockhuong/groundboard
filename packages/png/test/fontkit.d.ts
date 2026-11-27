// Minimal typings for the part of fontkit the font tests use.
declare module "fontkit" {
  export function openSync(path: string): { familyName: string; characterSet: number[] };
}
