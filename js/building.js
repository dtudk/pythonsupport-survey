/**
 * Building selection module
 * @fileoverview Manages building selection and navigation between setup and survey views
 */
import { CONFIG } from './config.js';
import { showError } from './errors.js';

/**
 * Building selection manager class
 * Handles building selection, local storage, and view transitions
 */
export class BuildingManager {
  /**
   * Create a BuildingManager instance
   * Loads previously selected building and sets up event listeners
   */
  constructor() {
    this.selectedBuilding = this.loadSelectedBuilding();
    this.setupEventListeners();
  }

  loadSelectedBuilding() {
    const saved = localStorage.getItem(CONFIG.storage.building);
    if (saved) return Number(saved);

    // Check URL parameters
    const urlParams = new URLSearchParams(location.search);
    const qpBuilding = urlParams.get('b');
    if (qpBuilding) {
      const building = Number(qpBuilding);
      localStorage.setItem(CONFIG.storage.building, building);
      return building;
    }

    return null;
  }

  selectBuilding(buildingNumber) {
    this.selectedBuilding = buildingNumber;
    localStorage.setItem(CONFIG.storage.building, buildingNumber);
    this.showSurveyForm();
  }

  selectCustomBuilding() {
    const customInput = document.getElementById('customBuilding');
    const buildingNumber = parseInt(customInput.value);
    
    if (!customInput.value || isNaN(buildingNumber) || buildingNumber <= 100 || buildingNumber >= 500) {
      showError('Please enter a valid building number (101-499).');
      return;
    }
    
    this.selectBuilding(buildingNumber);
  }

  handleEnterKey(event) {
    if (event.key === 'Enter') {
      this.selectCustomBuilding();
    }
  }

  showBuildingSelection() {
    localStorage.removeItem(CONFIG.storage.building);
    this.selectedBuilding = null;
    
    document.getElementById('buildingSelectionPage').classList.remove('hidden');
    document.getElementById('surveyPage').classList.add('hidden');
    document.getElementById('analyticsPage').classList.add('hidden');
    
    // Preserve Workshop Day checkbox state
    const workshopToggle = document.getElementById('workshopDayToggle');
    if (workshopToggle) {
      const isWorkshopDay = localStorage.getItem(CONFIG.storage.workshopDay) === 'true';
      workshopToggle.checked = isWorkshopDay;
    }
  }

  showSurveyForm() {
    document.getElementById('buildingSelectionPage').classList.add('hidden');
    document.getElementById('surveyPage').classList.remove('hidden');
    document.getElementById('analyticsPage').classList.add('hidden');
    
    // Set workshop preference
    const urlParams = new URLSearchParams(location.search);
    const qpWD = urlParams.get('wd') === '1';
    const preferWD = qpWD || (localStorage.getItem(CONFIG.storage.workshopDay) === 'true');
    
    const workshopYes = document.getElementById('workshop_yes');
    const workshopNo = document.getElementById('workshop_no');
    
    if (workshopYes && workshopNo) {
      workshopYes.checked = !!preferWD;
      workshopNo.checked = !preferWD;
    }
  }

  setupEventListeners() {
    // Note: Back tab navigation is now handled in app.js
    // Workshop day toggle is handled in links.js

    // Make methods available globally
    window.selectBuilding = (buildingNumber) => this.selectBuilding(buildingNumber);
    window.selectCustomBuilding = () => this.selectCustomBuilding();
    window.handleEnterKey = (event) => this.handleEnterKey(event);
    window.showBuildingSelection = () => this.showBuildingSelection();
  }

  getSelectedBuilding() {
    return this.selectedBuilding;
  }
}