// The household's duck and hedgehog, drawn as small SVG illustrations so their
// colours never depend on the phone's emoji font: a green duck that faces
// right and a brown hedgehog that faces left (towards the house in the home
// scene). Used by the home scene and the confetti. Profile avatars stay emoji.

/** A green duck facing right: green head and body, darker wing, orange bill and feet. */
export const DUCK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="4.5 6 41 41">' +
  // Feet
  '<path d="M17.6 40.6v3.8c0 .9.7 1.6 1.6 1.6h5.1c1 0 1.2-1.1.4-1.6l-4-3.6z" fill="#E98019"/>' +
  '<path d="M24.6 40.6v3.8c0 .9.7 1.6 1.6 1.6h5.1c1 0 1.2-1.1.4-1.6l-4-3.6z" fill="#F7972A"/>' +
  // Body, with a soft shade along the underside
  '<path d="M5 22.6c2.5 3.7 6.5 4 10.5 3.2 4.5-.8 8.5-.8 12.5-.2 6.5 1 11.5 3.9 11.5 8.4 0 5.6-6 8.5-14 8.5h-8C10.5 42.5 6 38.5 6 32c0-3.5-1-6.5-1-9.4z" fill="#62BD64"/>' +
  '<path d="M8.4 37.6c2.4 3.2 6 4.9 9.1 4.9h8c7.6 0 13.4-2.6 13.9-7.6-2.6 3.2-7.6 4.5-14.4 4.5h-7.4c-3.6 0-6.6-.6-9.2-1.8z" fill="#4EA752" opacity=".6"/>' +
  // Wing
  '<path d="M10.4 29.4c3.9-1 11.6-1.8 15.8 1.2 2.8 2-.2 6.4-6.2 6.5-4.6.1-7.8-2.9-9.6-7.7z" fill="#3B984A"/>' +
  // Neck and head, with a little shine
  '<ellipse cx="30.4" cy="24.6" rx="6.6" ry="6" fill="#62BD64"/>' +
  '<circle cx="30.6" cy="16.6" r="8.6" fill="#56B45C"/>' +
  '<ellipse cx="27.4" cy="12.4" rx="3" ry="1.7" transform="rotate(-28 27.4 12.4)" fill="#fff" opacity=".2"/>' +
  // Bill
  '<path d="M37.4 16.2c3.6-1 7.4-.2 8.1 1.7.5 1.5-2.7 3-7.1 3z" fill="#FF9F2E"/>' +
  '<path d="M38.3 19.4c3.4.2 6.3-.2 7-1 .1 1.5-3 2.8-6.8 2.6z" fill="#E57F18"/>' +
  // Eye
  '<circle cx="33" cy="14.2" r="2.9" fill="#fff"/>' +
  '<circle cx="33.8" cy="14.4" r="1.65" fill="#1D2A21"/>' +
  '<circle cx="34.3" cy="13.8" r=".55" fill="#fff"/>' +
  '</svg>';

/** A brown hedgehog facing left: spiky brown back, tan face and belly, dark nose and eye, little feet. 4:3. */
export const HEDGEHOG_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="4.2 14.2 42.6 32">' +
  // Feet and belly
  '<ellipse cx="19.4" cy="43" rx="2.3" ry="1.6" fill="#5E3C21"/>' +
  '<ellipse cx="32.6" cy="43" rx="2.3" ry="1.6" fill="#5E3C21"/>' +
  '<path d="M14.6 37.4c2.6 3.8 7.2 5.2 12.8 5.2 5.4 0 10.2-1.8 12-5.4z" fill="#DDB283"/>' +
  // Spiky coat, two layers of spikes
  '<path d="M13.8 28.9L12.9 25.2L16 25.9L16.7 21.3L19.4 23.6L21.7 18.7L23.5 22.3L27.5 17.6L28 22.1L33.4 18.2L32.3 23L38.8 20.3L36 25L43 23.8L38.6 27.9L45.6 28.2L39.9 31.2L46.4 33.1L39.7 34.7C39.4 38.4 34.6 41.4 27.4 41.4H20.5c-4.6 0-7.2-5-6.7-12.5z" fill="#865528"/>' +
  '<path d="M18.5 29.7L18.8 26.5L20.8 27.8L22.4 24.3L23.9 26.7L26.8 23.2L27.3 26.3L31.3 23.3L30.7 26.8L35.6 24.7L33.7 28.1L39 27.1L35.8 30.1L41.2 30.3L36.9 32.5C36 36 32 37.6 27 37.6H22c-2.6 0-3.8-3.4-3.5-7.9z" fill="#A06B39"/>' +
  // Face
  '<path d="M21.6 25.4c-4.6.6-10 4.2-14.3 8.7-1.6 1.7-.8 4 1.4 4.4 4.4.8 9.8 3.2 13.4 3.6 3.3-4 4-13-.5-16.7z" fill="#EBC99E"/>' +
  // Nose, eye, ear, cheek
  '<circle cx="6.8" cy="35.8" r="2.2" fill="#3A281B"/>' +
  '<circle cx="6.2" cy="35.2" r=".6" fill="#fff" opacity=".6"/>' +
  '<circle cx="14.4" cy="31.6" r="1.75" fill="#2A1C12"/>' +
  '<circle cx="14.9" cy="31" r=".55" fill="#fff"/>' +
  '<circle cx="20.3" cy="27.6" r="2.4" fill="#D7A877"/>' +
  '<circle cx="20.2" cy="27.8" r="1.1" fill="#C48562"/>' +
  '<ellipse cx="13.6" cy="35.6" rx="2" ry="1.3" fill="#F2948A" opacity=".5"/>' +
  '</svg>';

function dataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** `<img src>` for the duck. */
export const DUCK_URL = dataUrl(DUCK_SVG);
/** `<img src>` for the hedgehog. */
export const HEDGEHOG_URL = dataUrl(HEDGEHOG_SVG);

export type Animal = 'duck' | 'hedgehog';

export const ANIMAL_URL: Record<Animal, string> = { duck: DUCK_URL, hedgehog: HEDGEHOG_URL };
