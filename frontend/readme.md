# DTU Python Support Survey

A web-based student satisfaction survey and internal problem log for DTU Python Support services.


## File Structure

```
├── index.html              # Main survey application
├── assets/                 # Satisfaction rating images (face1-5.png)
├── css/                    # Stylesheets (main, kiosk, course-autocompleat)
├── js/                     # JavaScript modules (app, auth, building, config, errors, failsafe, kiosk, problem-log, survey, viewport)
├── partials/               # HTML templates (building-selection, modals, mode-selection, problem-log, sidebar, survey-form)
├── data/courses.json       # Course data for autocomplete
└── readme.md               # Documentation
```

## Features

- Form selection screen for supporters (customer satisfaction or internal logging)
- Internal problem log for supporters to record common issues after helping a student
- Building selection interface
- One-time link generation for our Discord help
- QR code generation for static URLs
- Student/Employee role selection
- Satisfaction rating with visual feedback
- Course autocomplete from the course list
- Kiosk/Tablet Mode: Fullscreen locked mode for public tablet deployment

## Usage

Django serves the application at the site root (see [Development](../docs/development.md) to run it locally). The application includes:

1. Form Selection: After logging in, supporters choose between Customer Satisfaction and Internal Logging. The sidebar's "Choose form" link returns here.
2. Building Selection: Choose from predefined buildings or enter custom building number (Customer Satisfaction only)
3. Survey Form: Fill out satisfaction survey with student number/DTU credentials
4. Internal Logging: Tick common problems (or describe another one) and submit them to the backend

## Authentication

The application uses password-based authentication for supporters, with automatic bypass for student access:

- Regular Access (`/`): Requires daily access code authentication, then opens the form selection screen
- One-time Links (`?token=TOKEN`) and QR Code Links (`?t=TOKEN`): Bypass authentication, direct access to survey (see [Architecture](../docs/structure.md) for how long each link lasts)
- Reset (`?reset=1`): Clears the saved supporter login

Student links add the `student-flow` class to `<body>`, which hides the header, sidebar and other pages and gives the survey its narrow student layout (`css/main.css`, `partials/survey-form.html`).

Students (one-time links, QR codes and kiosk mode) always go straight to the survey and never see the form selection screen or the internal problem log.

The internal problem log uses the same supporter login as the survey and posts to `/api/problem-logs/` on the Django backend. It has no offline queue: if the backend is unreachable or the session has expired, the form keeps its values and asks the supporter to log in again.

## Architecture

`index.html` loads `js/app.js` as an ES module, which fills the page with the HTML files in `partials/`. The JavaScript is plain module functions, one file per concern (see File Structure).

## Kiosk/Tablet Mode

Kiosk mode provides secure tablet deployment in public spaces.

### Activation

- Toggle Button: Click the black "Enter Tablet mode" button in the bottom-right corner of the survey (hidden for students on links)

### Features

- Fullscreen Mode: Enters fullscreen, locks the screen to landscape and keeps the screen awake
- Navigation Hiding: Hides sidebar, header, and navigation elements
- Interaction Blocking: Disables text selection outside text fields and the context menu
- Touch Optimization: Larger touch targets and optimized layouts for tablets

### Security Features

- Blocks F5, Ctrl/Cmd+R, Ctrl/Cmd+W, Ctrl/Cmd+N, Alt+Left/Right, Escape, and Backspace outside text fields

### Exit Mechanisms for Administrators

- Hidden Tap Zone: Tap the top-right corner 5 times within 1.5 seconds
- Leaving Fullscreen: Kiosk mode ends whenever the browser leaves fullscreen

## Dependencies

- Tailwind CSS (via CDN)
