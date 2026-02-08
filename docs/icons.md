# Custom SVG Icons

This UI renders device avatars using inline SVGs returned by `deviceIcon()` in the front-end scripts.
To add or override icons, follow the steps below.

## 1) Place your SVG assets

Store any custom SVG files in:

```
web/assets/icons/
```

Keep icons simple and consistent:

- **Size:** 24×24 viewBox (e.g. `viewBox="0 0 24 24"`).
- **Style:** stroke-based, monoline.
- **Colors:** use `stroke="currentColor"` and `fill="none"` so colors inherit from CSS.

## 2) Wire a new device type

1. Update `getDeviceTypeToken()` to normalize your new device type string.
2. Add the SVG markup to `deviceIcon()`.

Files:

- `web/app.js`
- `web/user.js`

## 3) Configure avatar colors

Add a CSS rule so the icon inherits the right accent color:

```css
.device-avatar[data-type="your_type"] {
  background: rgba(101, 161, 255, 0.15);
  color: #65a1ff;
}
```

File:

- `web/styles.css`

## 4) Check the result

Open the UI and verify the icon appears correctly in the device list and device details panel.
