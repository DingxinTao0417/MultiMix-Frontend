# Library Dynamic Loading Empty State Design

> Status: archived
> Owner: frontend
> Last verified: 2026-07-11

## Problem

`LibraryWorkshop` is loaded through `next/dynamic` with `loading: () => null`. After a local Next.js restart or while the library chunk is still loading, the workspace renders only the library title and a blank body. This is visually indistinguishable from a broken page and differs from the real empty-library state, which already says “这个分类还没有内容”.

## Decision

Use a shared, visible dynamic-workspace fallback for asset, copy, image, and video libraries.

- While the chunk is loading, retain the library workspace area and show a lightweight skeleton plus `正在加载<库名称>…`.
- The fallback must be accessible through `role="status"` and `aria-live="polite"`.
- Keep the existing true empty state unchanged: `这个分类还没有内容`.
- Add a client error boundary around the library workspace. If dynamic rendering throws, show `加载失败，请重新加载` and a `重新加载` button that reloads the current page.
- Do not change API requests, authentication, library filters, data mapping, or stored content.

## Components

- `LibraryWorkspaceLoading`: pure presentational fallback receiving the current library title.
- `LibraryWorkspaceErrorBoundary`: catches render/chunk errors for the library body and exposes a reload action.
- `AssetsWorkspaceClient`: replaces the null dynamic fallback and wraps `LibraryWorkshop` with the error boundary.

## Validation

- A regression test must fail if `LibraryWorkshop` returns to `loading: () => null`.
- Loading fallback must expose `正在加载图片库…` for the image view and equivalent text for the other libraries.
- Error fallback must expose `加载失败，请重新加载` and one `重新加载` button.
- Existing `LibraryWorkshop` empty state remains visible when rows are empty.
- Run frontend focused tests, full unit tests, typecheck, lint, build, and `docs:check`.
