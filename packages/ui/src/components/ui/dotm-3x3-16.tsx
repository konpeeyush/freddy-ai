"use client";

/*
 * `dotmatrix-core` lives in `components/`, not the `lib/` the registry writes
 * it to. This package maps `./lib/*` to `*.ts` and `./components/*` to `*.tsx`
 * — and the core renders JSX, so under `lib/` the specifier resolved to a
 * `.ts` file that does not exist. The production build papered over it; the
 * dev server did not.
 *
 * Re-running `shadcn add @dotmatrix/...` will put it back under `lib/` and
 * rewrite this import. Move it and fix the path again.
 */

import { createGlyphSpin3Component } from "@workspace/ui/components/dotmatrix-core";
import type { DotMatrixCommonProps } from "@workspace/ui/components/dotmatrix-core";

export type Dotm3x3_16Props = DotMatrixCommonProps;

/** Smiley — eyes and mouth in row-major 0/1 form. */
const SMILEY_GLYPH = [1, 0, 1, 0, 0, 0, 0, 1, 0] as const;

export const Dotm3x3_16 = createGlyphSpin3Component("Dotm3x3_16", SMILEY_GLYPH);
