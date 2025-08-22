/**
 * Configuration settings for the DTU Python Support Survey application
 * @namespace CONFIG
 */
export const CONFIG = {
  /** API endpoints */
  endpoints: {
    survey: "https://python-support-proxy.azurewebsites.net/api/surveyProxy", // Update this URL for new SharePoint list
    token: "https://python-support-proxy.azurewebsites.net/api/issueToken",
    qrSign: "https://python-support-proxy.azurewebsites.net/api/qrRedirect"
  },
  
  /** Path to the CSV file containing course data */
  csvPath: './data/courses.csv',
  
  // SharePoint configuration (if using direct integration)
  sharepoint: {
    siteUrl: "", // Your SharePoint site URL
    listName: "", // Your SharePoint list name
    tenantId: "", // Your Azure tenant ID
    clientId: "", // App registration client ID
  },
  
  /** Local storage keys */
  storage: {
    auth: "surveySupportAuth",
    building: "selectedBuilding",
    workshopDay: "workshopDay"
  },
  
  /** External URLs */
  urls: {
    pythonSupport: "https://pythonsupport.dtu.dk/"
  },
  
  /** Timing configurations (in milliseconds) */
  timing: {
    thankYouDisplay: 3000,
    redirectDelay: 7000
  }
};

/**
 * QR Code configuration settings
 * @namespace QR_CONFIG
 */
export const QR_CONFIG = {
  /** QR code dimensions */
  size: 280,
  
  /** QR code margin */
  margin: 2,
  
  /** Fallback QR code generation services */
  fallbackServices: [
    "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=",
    "https://chart.googleapis.com/chart?chs=280x280&cht=qr&chl="
  ]
};