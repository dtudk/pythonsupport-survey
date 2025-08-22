/**
 * Survey form module for handling survey data collection and submission
 * @fileoverview Manages survey form interactions, validation, and data submission
 */
import { CONFIG } from './config.js';
import { showError, friendlyError } from './errors.js';

/**
 * Survey form manager class
 * Handles form setup, validation, course data loading, and survey submission
 */
export class SurveyManager {
  /**
   * Create a SurveyManager instance
   * @param {AuthManager} authManager - Authentication manager instance
   * @param {BuildingManager} buildingManager - Building selection manager instance
   */
  constructor(authManager, buildingManager) {
    this.authManager = authManager;
    this.buildingManager = buildingManager;
    this.setupForm();
    this.loadCourseData();
  }

  /**
   * Set up form event listeners and validation
   * Configures role switching and student number validation
   */
  setupForm() {
    const form = document.getElementById("surveyForm");
    const roleInputs = form.querySelectorAll('input[name="role"]');
    const studentWrapper = document.getElementById('studentWrapper');
    const usernameWrapper = document.getElementById('usernameWrapper');
    const studentNumInput = document.getElementById('student_number');
    
    // Role switching
    roleInputs.forEach(radio => radio.addEventListener('change', () => this.toggleRole()));
    
    // Student number validation
    if (studentNumInput) {
      studentNumInput.addEventListener('input', () => {
        studentNumInput.setCustomValidity('');
      });
      studentNumInput.addEventListener('blur', () => this.setStudentCustomValidation());
      studentNumInput.addEventListener('invalid', () => this.setStudentCustomValidation());
    }
    
    // Form submission
    form.addEventListener("submit", (e) => this.handleSubmit(e));
    
    // Thank you modal close
    document.getElementById("closeModal").addEventListener('click', () => {
      this.handleThankYouClose();
    });
    
    this.toggleRole();
  }

  toggleRole() {
    const form = document.getElementById("surveyForm");
    const studentWrapper = document.getElementById('studentWrapper');
    const usernameWrapper = document.getElementById('usernameWrapper');
    
    const isStudent = form.role.value === 'student';
    studentWrapper.classList.toggle('hidden', !isStudent);
    usernameWrapper.classList.toggle('hidden', isStudent);
    form.student_number.required = isStudent;
    form.dtu_username.required = !isStudent;
    
    this.setStudentCustomValidation();
  }

  setStudentCustomValidation() {
    const form = document.getElementById("surveyForm");
    const studentNumInput = document.getElementById('student_number');
    const isStudent = (form.role.value === 'student');
    
    if (!isStudent) {
      studentNumInput.setCustomValidity('');
      return;
    }
    
    const v = (studentNumInput.value || '').trim();
    if (!v) {
      studentNumInput.setCustomValidity("Please enter your student number: type the 6 digits after 's' (e.g. s123456).");
    } else if (!/^\d{6}$/.test(v)) {
      studentNumInput.setCustomValidity("Format: exactly 6 digits. Example: s123456. Don't type the 's'—it's already filled in.");
    } else {
      studentNumInput.setCustomValidity('');
    }
  }

  async loadCourseData() {
    try {
      const res = await fetch('./data/courses.csv');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const csv = await res.text();
      const lines = csv.split('\n');
      const records = [];
      let buffer = '';
      let inQuotes = false;
      
      lines.forEach(line => {
        const quoteCount = (line.match(/"/g) || []).length;
        if (!inQuotes) {
          buffer = line;
          if (quoteCount % 2 !== 0) {
            inQuotes = true;
          } else {
            records.push(buffer);
          }
        } else {
          buffer += '\n' + line;
          if (quoteCount % 2 !== 0) {
            inQuotes = false;
            records.push(buffer);
          }
        }
      });
      
      records.shift(); // Remove header
      const dl = document.getElementById('courses');
      
      records.forEach(record => {
        const idx = record.indexOf(',');
        const code = record.slice(0, idx).trim();
        let rawName = record.slice(idx + 1)
          .replace(/\r/g, '')
          .replace(/CR$/, '')
          .replace(/^"+|"+$/g, '')
          .trim();
        
        const opt = document.createElement('option');
        opt.value = `${code} - ${rawName}`;
        dl.appendChild(opt);
      });
    } catch (err) {
      console.error('Error loading courses.csv:', err);
    }
  }

  async verifyOneTimeToken() {
    const linkToken = this.getLinkToken();
    if (!linkToken) return true;
    
    try {
      const resp = await fetch(CONFIG.endpoints.survey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': linkToken },
        body: JSON.stringify({ ping: true })
      });
      
      if (!resp.ok) {
        showError('Oops, this link has expired. Please request a new one-time link from your supporter.');
        document.querySelectorAll('#surveyForm input, #surveyForm select, #surveyForm textarea, #surveyForm button')
          .forEach(el => {
            if (el.id !== 'closeErrorModal') el.disabled = true;
          });
        return false;
      }
      return true;
    } catch {
      return true; // Allow proceeding if network error
    }
  }

  getLinkToken() {
    const urlParams = new URLSearchParams(location.search);
    return urlParams.get('t') || urlParams.get('token');
  }

  async handleSubmit(e) {
    e.preventDefault();
    
    const form = document.getElementById("surveyForm");
    const submitButton = document.getElementById("submitButton");
    
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    submitButton.classList.add('opacity-50', 'cursor-not-allowed');
    
    const isStudent = form.role.value === 'student';
    const linkToken = this.getLinkToken();
    
    const payload = {
      role: form.role.value,
      student_number: isStudent ? 's' + form.student_number.value.trim() : null,
      username: !isStudent ? form.dtu_username.value.trim() : null,
      satisfaction: Number(form.querySelector('input[name="satisfaction"]:checked').value),
      course_number: form.course_number.value.trim() || null,
      building_Number: this.buildingManager.getSelectedBuilding(),
      workshop: (form.elements['workshop'] && form.elements['workshop'].value === 'yes'),
      token: linkToken || null,
    };

    try {
      const headers = { "Content-Type": "application/json" };
      if (linkToken) {
        headers["x-token"] = linkToken;
      } else {
        headers["x-api-key"] = this.authManager.getApiKey();
      }
      
      const response = await fetch(CONFIG.endpoints.survey, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        this.handleSuccessfulSubmission(linkToken);
      } else {
        await this.handleSubmissionError(response, linkToken);
      }
    } catch (err) {
      console.error("Background submit failed:", err);
      showError('A network error occurred. Please check your connection and try again.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Submit Survey';
      submitButton.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  handleSuccessfulSubmission(linkToken) {
    const thankYouModal = document.getElementById("thankYouModal");
    
    if (linkToken) {
      // Thank you modal + auto-redirect after 7s; clicking Close redirects immediately
      thankYouModal.classList.remove('hidden');
      this.redirectOnThankYouClose = true;
      setTimeout(() => {
        window.location.replace(CONFIG.urls.pythonSupport);
      }, CONFIG.timing.redirectDelay);
      return;
    }
    
    // Regular submission - reset form and show thank you
    thankYouModal.classList.remove('hidden');
    this.resetForm();
    setTimeout(() => {
      thankYouModal.classList.add('hidden');
    }, CONFIG.timing.thankYouDisplay);
  }

  async handleSubmissionError(response, linkToken) {
    let raw = '';
    try {
      const ct = (response.headers.get('Content-Type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        const j = await response.json();
        raw = j?.message || (typeof j === 'string' ? j : JSON.stringify(j));
      } else {
        const t = await response.text();
        if (t && t.trim().length) raw = t.trim();
      }
    } catch {}
    
    showError(friendlyError(raw, response.status, !!linkToken), response.status);
    
    const form = document.getElementById("surveyForm");
    if (form.role.value === 'student') {
      form.student_number.focus();
    } else {
      form.dtu_username?.focus();
    }
  }

  resetForm() {
    const form = document.getElementById("surveyForm");
    form.reset();
    form.role.value = 'student';
    this.toggleRole();
    
    // Reset workshop preference
    const urlParams = new URLSearchParams(location.search);
    const qpWD = urlParams.get('wd') === '1';
    const preferWD = qpWD || (localStorage.getItem(CONFIG.storage.workshopDay) === 'true');
    
    const workshopYes = document.getElementById('workshop_yes');
    const workshopNo = document.getElementById('workshop_no');
    
    if (workshopYes && workshopNo) {
      workshopYes.checked = !!preferWD;
      workshopNo.checked = !preferWD;
    }
    
    document.getElementById('student_number').value = '';
    document.getElementById('student_number').focus();
    document.activeElement?.blur();
  }

  handleThankYouClose() {
    const linkToken = this.getLinkToken();
    if (this.redirectOnThankYouClose && linkToken) {
      window.location.replace(CONFIG.urls.pythonSupport);
    } else {
      document.getElementById("thankYouModal").classList.add('hidden');
    }
  }
}