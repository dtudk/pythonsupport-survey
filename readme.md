# DTU Python Support Survey

A web-based student satisfaction survey application for DTU Python Support services.

**Example:** https://www.student.dtu.dk/~s214960/python-support-survey/

## File Structure

```
├── index.html              # Main survey application
├── assets/                 # Satisfaction rating images (face1-5.png)
├── css/                    # Stylesheets (main, sidebar, modal, survey, compact, kiosk)
├── js/                     # JavaScript modules (app, auth, building, config, errors, kiosk, links, qr, survey, bundle)
├── components/             # HTML templates (analytics, building-selection, modals, sidebar, survey-form)
├── data/courses.csv        # Course data for autocomplete
└── readme.md               # Documentation
```

## Features

- Building selection interface
- One-time link generation for our Discord help
- QR code generation for static URLs
- Student/Employee role selection
- Satisfaction rating with visual feedback
- Course autocomplete from CSV data
- Analytics dashboard integration with PowerBI
- Kiosk/Tablet Mode: Fullscreen locked mode for public tablet deployment

## Usage

Open `index.html` in a web browser. The application includes:

1. Building Selection: Choose from predefined buildings or enter custom building number
2. Survey Form: Fill out satisfaction survey with student number/DTU credentials
3. Analytics: View survey statistics (requires authentication)

## Authentication

The application uses password-based authentication for supporters, with automatic bypass for student access:

- Regular Access (`/index.html`): Requires daily access code authentication
- One-time Links (`?t=TOKEN` or `?token=TOKEN`): Bypass authentication, direct access to survey
- QR Code Access (`?b=BUILDING`): Bypass authentication, direct access to survey

Both one-time links and QR code access automatically enable compact mode for an optimized experience.

## Architecture

The application uses a modular architecture with:

- Separation of Concerns: CSS, JavaScript, and HTML components are separated into logical modules
- Class-based JavaScript: ES6 classes for better code organization
- Modular CSS: Separate stylesheets for different UI concerns
- Component Templates: Reusable HTML components

## Development

For local development with file:// protocol:
- Use `index.html` with `bundle.js` (pre-bundled JavaScript)
- Components are inlined in the main HTML file

For server deployment:
- Use modular ES6 modules in `js/` directory
- Components can be loaded dynamically from `components/` directory
- Enable HTTP server to avoid CORS restrictions

## Compact Mode

Compact mode is automatically activated when accessing the application via one-time links or QR codes.

### Features

- Navigation Hiding: Automatically hides sidebar, header, and navigation elements
- Tablet Optimization: Optimized spacing, sizing, and touch targets for tablet use
- Focused Experience: Clean, distraction-free interface showing only the survey form
- Authentication Bypass: Skips password requirement for seamless student access

### Implementation

- CSS Styling: `css/compact.css` provides tablet-optimized layouts
- JavaScript Detection: Automatic detection in `js/app.js` and `js/bundle.js`
- Body Class: Adds `compact-mode` class to enable styling when parameters are detected

## Kiosk/Tablet Mode

Kiosk mode provides secure tablet deployment in public spaces.

### Activation

- URL Parameter: Add `?kiosk=1` or `?tablet=1` to the URL
- Toggle Button: Click the floating lock button in the bottom-right corner

### Features

- Fullscreen Mode: Automatically enters fullscreen
- Navigation Hiding: Hides sidebar, header, and navigation elements
- Interaction Blocking: Disables text selection, context menus, and keyboard shortcuts
- Touch Optimization: Larger touch targets and optimized layouts for tablets

### Security Features

- Prevents common keyboard shortcuts (F5, F11, F12, Ctrl+R, etc.)
- Blocks browser navigation and developer tools access
- Disables page refresh and tab switching
  
### Exit Mechanisms for Administrators

- Keyboard Shortcut: Adding "?reset=1" to the website
- Hidden Tap Zone: Click/tap the top-left corner 5 times within 3 seconds
- Temporary Exit Button: A red "Exit Kiosk" button appears after tap activation (auto-hides after 10 seconds)

## Dependencies

- Tailwind CSS (via CDN)
- QR Code generation library (via CDN)
- PowerBI for analytics dashboard
