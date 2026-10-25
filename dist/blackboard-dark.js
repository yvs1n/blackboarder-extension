// ============================================================
// UoS Blackboard Dark Mode - Content Script (v2.2)
// Safe Isolated-World Theme Manager + Dynamic CSSOM Style Engine
// ============================================================

(() => {
  'use strict';

  const THEME_CLASS = 'bbs-dark-active';
  const LEGACY_UOS_CLASS = 'uos-dark-active';
  // Blackboard's own, unfinished dark mode. Older versions switched it on; it paints pages #666,
  // so it is now only removed (when the old standalone theme is not managing it).
  const BB_DARK_CLASS = 'mode-dark';
  const DYNAMIC_STYLE_ID = 'bbs-dynamic-dark-rules';
  const STATIC_STYLE_ID = 'bbs-static-dark-rules';
  const STATIC_DARK_CSS = "/* ============================================================\n   UoS Blackboard Dark Mode - Native Token & Surgical Stylesheet\n   Version 2.0 - Safe, Fast, and Native Theme Styling\n   ============================================================ */\n\n/* 1. Native Blackboard Palette & Editor Tokens */\nhtml.bbs-dark-active,\nhtml.bbs-dark-active.mode-dark,\n:root.bbs-dark-active,\n:root.bbs-dark-active.mode-dark {\n  color-scheme: dark;\n\n  /* Mode & Brand (UoS Emerald / Teal) */\n  --palette-mode: dark;\n  --palette-brand-main: #26a69a;\n  --palette-brand-contrastText: #121214;\n  --palette-brand-light: rgba(38, 166, 154, 0.16);\n  --palette-brand-dark: #00695c;\n  --palette-brandAlt-main: #00897b;\n  --palette-brandAlt-contrastText: #ffffff;\n\n  /* Primary & Secondary Actions */\n  --palette-primary-main: #00897b;\n  --palette-primary-contrastText: #f4f4f5;\n  --palette-primary-light: #26a69a;\n  --palette-primary-dark: #00695c;\n  --palette-secondary-main: #2a2a30;\n  --palette-secondary-contrastText: #f4f4f5;\n  --palette-secondary-light: #3f3f46;\n  --palette-secondary-dark: #18181b;\n\n  /* Semantic Status Colors */\n  --palette-error-main: #ff5252;\n  --palette-error-contrastText: #121214;\n  --palette-error-light: rgba(255, 82, 82, 0.16);\n  --palette-error-dark: #991b1b;\n  --palette-success-main: #39e379;\n  --palette-success-contrastText: #121214;\n  --palette-success-light: rgba(57, 227, 121, 0.14);\n  --palette-success-dark: #166534;\n  --palette-info-main: #38bdf8;\n  --palette-info-contrastText: #121214;\n  --palette-info-light: rgba(56, 189, 248, 0.15);\n  --palette-info-dark: #075985;\n  --palette-warning-main: #facc15;\n  --palette-warning-contrastText: #121214;\n  --palette-warning-light: rgba(250, 204, 21, 0.16);\n  --palette-warning-dark: #854d0e;\n  --palette-caution-main: #fb923c;\n  --palette-caution-light: rgba(251, 146, 60, 0.16);\n\n  /* Interactive States */\n  --palette-action-active: #a1a1aa;\n  --palette-action-hover: #f4f4f5;\n  --palette-action-selected: #ffffff;\n  --palette-action-disabled: #52525b;\n  --palette-action-disabledBackground: #202024;\n  --palette-action-hoverOpacity: 0.06;\n  --palette-action-selectedOpacity: 0.12;\n  --palette-action-focus: rgba(255, 255, 255, 0.1);\n  --palette-action-activatedOpacity: 0.18;\n\n  /* Typography */\n  --palette-text-primary: #f4f4f5;\n  --palette-text-secondary: #a1a1aa;\n  --palette-text-disabled: #6e6e77;\n  --palette-text-hint: #71717a;\n\n  /* Focus, Links & Indicators */\n  --palette-focus-main: #26a69a;\n  --palette-focus-light: #00897b;\n  --palette-focus-dark: #00695c;\n  --palette-link-active: #4db6ac;\n  --palette-link-hover: #80cbc4;\n  --palette-link-selected: #4db6ac;\n  --palette-link-disabled: #6e6e77;\n  --palette-indicatorPrimary-main: #26a69a;\n  --palette-indicatorPrimary-contrastText: #121214;\n  --palette-indicatorPrimary-dark: #4db6ac;\n\n  /* Borders & Dividers */\n  --palette-border-main: #2a2a30;\n  --palette-border-dark: #3f3f46;\n  --palette-divider: rgba(255, 255, 255, 0.08);\n\n  /* Carbon Surface Hierarchy */\n  --palette-background-default: #121214;\n  --palette-background-paper: #18181b;\n  --palette-background-b1: #18181b;\n  --palette-background-b2: #141417;\n  --palette-background-b3: #202024;\n  --palette-background-b4: #27272c;\n  --palette-background-b5: #3a3a42;\n  --palette-background-b6: #71717a;\n  --palette-background-b7: #27272c;\n  --palette-background-b8: #3f3f46;\n  --palette-background-b9: #18181b;\n  --palette-background-b10: #ffffff;\n\n  /* Common & Grey Scale */\n  --palette-common-white: #ffffff;\n  --palette-common-black: #000000;\n  --palette-grey-50: #18181b;\n  --palette-grey-100: #202024;\n  --palette-grey-200: #27272c;\n  --palette-grey-300: #2e2e34;\n  --palette-grey-400: #3f3f46;\n  --palette-grey-500: #52525b;\n  --palette-grey-600: #71717a;\n  --palette-grey-700: #a1a1aa;\n  --palette-grey-800: #d4d4d8;\n  --palette-grey-900: #f4f4f5;\n  --palette-grey-A100: #202024;\n  --palette-grey-A200: #27272c;\n  --palette-grey-A400: #3f3f46;\n  --palette-grey-A700: #a1a1aa;\n\n  /* Urgency & Grade Tokens (Native Blackboard Dark Palette) */\n  --palette-urgency-high: #e3793e;\n  --palette-urgency-medium: #66b6e1;\n  --palette-urgency-low: #cde2ee;\n  --palette-grade-excellent: #1dcd6a;\n  --palette-grade-veryGood: #86e64f;\n  --palette-grade-good: #c9e04a;\n  --palette-grade-fair: #67dbe2;\n  --palette-grade-borderline: #6cc0f7;\n  --palette-grade-warning: #96adff;\n  --palette-grade-low: #c2a6e1;\n  --palette-grade-veryLow: #e899e1;\n  --palette-grade-critical: #ffe54a;\n  --palette-grade-failing: #ffc04a;\n  --palette-grade-severeFailing: #ffa557;\n  --palette-grade-extremeFailing: #ff9192;\n  --palette-highContrastOnly-main: rgba(0, 0, 0, 0.001);\n\n  /* Rich Text Editor Tokens */\n  --editor-font-gray: #d4d4d8;\n  --editor-font-purple: #e9d5ff;\n  --editor-font-blue: #bae6fd;\n  --editor-font-green: #bbf7d0;\n  --editor-font-red: #fecaca;\n  --editor-highlight-gray: #27272c;\n  --editor-highlight-purple: #581c87;\n  --editor-highlight-blue: #0c4a6e;\n  --editor-highlight-green: #14532d;\n  --editor-highlight-yellow: #713f12;\n  --editor-highlight-orange: #7c2d12;\n  --editor-highlight-red: #7f1d1d;\n}\n\n/* 2. Root Canvas & Scrollbars */\nhtml.bbs-dark-active,\nhtml.bbs-dark-active body,\nhtml.bbs-dark-active .attendance-app body {\n  background-color: var(--palette-background-default) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active ::-webkit-scrollbar {\n  width: 8px;\n  height: 8px;\n}\n\nhtml.bbs-dark-active ::-webkit-scrollbar-track {\n  background: #121214;\n}\n\nhtml.bbs-dark-active ::-webkit-scrollbar-thumb {\n  background: #2e2e34;\n  border-radius: 4px;\n}\n\nhtml.bbs-dark-active ::-webkit-scrollbar-thumb:hover {\n  background: #3f3f46;\n}\n\n/* 3. Left Navigation Sidebar (Preserves Native UoS Emerald Accent) */\nhtml.bbs-dark-active #global-nav-flyout,\nhtml.bbs-dark-active .left-off-canvas-menu,\nhtml.bbs-dark-active nav.Global-navigation {\n  background-color: #0e0e10 !important;\n  border-inline-end: 1px solid var(--palette-border-main) !important;\n}\n\n/* 4. Legacy Foundation / AngularJS Shell Surfaces */\nhtml.bbs-dark-active .tabs-content,\nhtml.bbs-dark-active .off-canvas-overlay .right-off-canvas-menu,\nhtml.bbs-dark-active .bb-offcanvas-panel .bb-offcanvas-panel-content,\nhtml.bbs-dark-active .reveal-modal,\nhtml.bbs-dark-active .f-dropdown,\nhtml.bbs-dark-active .f-dropdown.content {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .tooltip,\nhtml.bbs-dark-active .inline-validation.f-dropdown.content,\nhtml.bbs-dark-active span.enhanced-tooltip,\nhtml.bbs-dark-active .grade-grid-reborn-message .validation-message-wrapper {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45) !important;\n}\n\nhtml.bbs-dark-active .tooltip > .nub::after,\nhtml.bbs-dark-active .inline-validation.f-dropdown.content > .nub::after,\nhtml.bbs-dark-active span.enhanced-tooltip-pip {\n  background-color: var(--palette-background-b3) !important;\n  border-color: var(--palette-border-main) !important;\n  box-shadow: none !important;\n}\n\nhtml.bbs-dark-active .button.secondary,\nhtml.bbs-dark-active .button.secondary:focus,\nhtml.bbs-dark-active .attendance-app .dropdown-wrapper .button.secondary {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n  border: 1px solid var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .button.secondary:hover {\n  background-color: var(--palette-background-b4) !important;\n}\n\nhtml.bbs-dark-active .button--secondary.disabled,\nhtml.bbs-dark-active .button--secondary[disabled],\nhtml.bbs-dark-active .attendance-app .dropdown-wrapper .button--secondary.disabled,\nhtml.bbs-dark-active .attendance-app .dropdown-wrapper .button--secondary[disabled] {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-disabled) !important;\n}\n\nhtml.bbs-dark-active .button--dashed:active,\nhtml.bbs-dark-active .button--dashed:focus:not(:hover),\nhtml.bbs-dark-active .is-empty-page .element-list-add-menu li a:active,\nhtml.bbs-dark-active .is-empty-page .element-list-add-menu li button:active {\n  background-color: var(--palette-background-b3) !important;\n}\n\nhtml.bbs-dark-active .alert-box.secondary,\nhtml.bbs-dark-active .label.secondary {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active code {\n  background-color: var(--palette-background-b3) !important;\n  border-color: var(--palette-border-main) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .fs-table thead,\nhtml.bbs-dark-active .fs-table tfoot {\n  background-color: var(--palette-background-b3) !important;\n}\n\nhtml.bbs-dark-active .reveal-modal__divider::before {\n  background: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .add-element .button-add-content .add-circle-default,\nhtml.bbs-dark-active .avatar.outline::before,\nhtml.bbs-dark-active .element-image.avatar.outline::before {\n  background-color: var(--palette-background-b1) !important;\n}\n\n/* 5. Activity Stream & Courses Legacy Elements */\nhtml.bbs-dark-active .base-recent-activity .activity-stream .activity-group::after {\n  background-color: var(--palette-background-b3) !important;\n  border-color: var(--palette-border-dark) !important;\n}\n\nhtml.bbs-dark-active .base-courses .course-columns.list-column-view .element-card .element-details .status-bar .course-status .status-icon,\nhtml.bbs-dark-active .base-courses .multi-column-view .course-org-list .element-card .element-details.summary .controls .info-icon,\nhtml.bbs-dark-active .usercard .header .element-details .userId,\nhtml.bbs-dark-active .usercard .header .element-details .profile,\nhtml.bbs-dark-active .student-card .student-info .info .profile {\n  color: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active bb-search-box > div > bb-svg-icon[icon=\"search\"],\nhtml.bbs-dark-active bb-search-box > div > button,\nhtml.bbs-dark-active .filter-list-content .filter-panel-container .filter-panel-clear-all {\n  color: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active .filter-list-content .filter-panel-container .filter-panel-item-checkbox .check-box-label,\nhtml.bbs-dark-active .slider-tab-navigation-small__tab:hover,\nhtml.bbs-dark-active .slider-tab-navigation-small__tab_active {\n  color: var(--palette-text-primary) !important;\n}\n\n/* 6. Attendance Grid (10818-*.css static hex overrides) */\nhtml.bbs-dark-active .attendance-app .grid__cell,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty.-readonly,\nhtml.bbs-dark-active .attendance-app .meeting-view-grid .meeting-view-row.-empty .grid__cell.-header.-exempt,\nhtml.bbs-dark-active .attendance-app .meeting-view-grid .meeting-view-row.-empty .grid__cell.-header.-readonly {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .attendance-app .grid__cell.-exempt,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty:hover,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty:focus,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty.-exempt,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty.-readonly:hover,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty.-readonly:focus,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty.-readonly.-exempt,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-exempt:not(.-header):hover,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-exempt:not(.-header):focus,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-exempt:not(.-header).-active,\nhtml.bbs-dark-active .attendance-app .meeting-view-grid .meeting-view-row.-empty .grid__cell.-header,\nhtml.bbs-dark-active .attendance-app .list-row__button--unmarked {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active .attendance-app .overall-view-grid .grid__body .grid__row:hover .-record.-excused,\nhtml.bbs-dark-active .attendance-app .overall-view-grid .grid__body .grid__row:hover .-record.-incomplete.-readonly,\nhtml.bbs-dark-active .attendance-app .overall-view-grid .grid__body .grid__row:hover .-record.-exempt,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-active.-excused,\nhtml.bbs-dark-active .attendance-app .list-row__button--excused {\n  background-color: var(--palette-background-b4) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .attendance-app .overall-view-grid .grid__body .grid__row:hover .-record.-late,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-active.-late,\nhtml.bbs-dark-active .attendance-app .list-row__button--late {\n  background-color: rgba(250, 204, 21, 0.2) !important;\n  color: #fde047 !important;\n}\n\nhtml.bbs-dark-active .attendance-app .attendance-grade-pill {\n  color: #121214 !important;\n}\n\nhtml.bbs-dark-active .attendance-app .attendance-grade-pill.-empty {\n  background-color: var(--palette-background-b3) !important;\n  border-color: var(--palette-border-dark) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .attendance-app .attendance-grade-pill.-pending {\n  background-color: var(--palette-background-b4) !important;\n  color: var(--palette-text-secondary) !important;\n}\n\n/* 7. Assessments, Submissions & Gradebook Legacy Rules */\nhtml.bbs-dark-active .student-submission .submission-to-grade .answer-to-grade,\nhtml.bbs-dark-active .tests .multiple-choice-question-saved ol li,\nhtml.bbs-dark-active .attempt-grading-container .multiple-choice-question-saved ol li,\nhtml.bbs-dark-active .assessment-question .question-content:not(.active) div.multiple-answer-answers .option-answer.answer-not-selected-not-posted,\nhtml.bbs-dark-active .assessment-question .question-content:not(.active) div.true-false-answers .option-answer.answer-not-selected-not-posted,\nhtml.bbs-dark-active .readonly-question-component-react .readonly-question-header__pill {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .grade-grid-container .overall-grade-setup,\nhtml.bbs-dark-active .rb-grid .rb-cell,\nhtml.bbs-dark-active .typeahead-search .typeahead-search-autocomplete .typeahead-search-entry {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .rb-grid .rb-grid-scrollbar-placeholder-x,\nhtml.bbs-dark-active .rb-grid .rb-grid-scrollbar-placeholder-y,\nhtml.bbs-dark-active .not-graded-exempt {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active .grade-grid-container .grade-grid-header-cell .grade-grid-header-summary button bb-svg-icon,\nhtml.bbs-dark-active .base-grades .base-grades-course-tile .grade-progress-chart-btn .grade-progress-chart-link bb-svg-icon,\nhtml.bbs-dark-active *[bb-timed-test-indicator] *[bb-timed-test-indicator-label] .label-timed-indicator span,\nhtml.bbs-dark-active .discussion-insights h2,\nhtml.bbs-dark-active .discussion-insights h3,\nhtml.bbs-dark-active .discussion-insights .discussion-insights-heading,\nhtml.bbs-dark-active .discussion-insights .non-participant .stacked bdi {\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .notice__text,\nhtml.bbs-dark-active .percentage-label,\nhtml.bbs-dark-active .rubric-list .rubric-list-association-item .item-rubric-type,\nhtml.bbs-dark-active .grade-grid-search-box .typehead-title .grade-type,\nhtml.bbs-dark-active .grade-grid-search-box .no-result,\nhtml.bbs-dark-active .grade-grid-container .grade-grid-body-cell .exception-icon,\nhtml.bbs-dark-active .matching-attempt-review-pair__answer__text--ungraded .bb-editor-root .ql-editor.bb-editor,\nhtml.bbs-dark-active .matching-attempt-review-pair__answer__text--ungraded .selectboxArrowIcon {\n  color: var(--palette-text-secondary) !important;\n}\n\n/* 8. FullCalendar & Messages Legacy Rules */\nhtml.bbs-dark-active .calendar-wrapper .fullcalendar-container .fc-monthWithoutDD-view .fc-other-month.fc-day {\n  background-color: #0e0e10 !important;\n}\n\nhtml.bbs-dark-active .fc-unthemed .fc-popover,\nhtml.bbs-dark-active .fc-unthemed .fc-popover .fc-header {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .fc-state-default {\n  background: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n  text-shadow: none !important;\n  box-shadow: none !important;\n}\n\nhtml.bbs-dark-active .fc-state-hover,\nhtml.bbs-dark-active .fc-state-down,\nhtml.bbs-dark-active .fc-state-active {\n  background: var(--palette-background-b4) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .messages-container-summary .messages-header .messages-off {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active .messages-container .conversation-container .message-card .message-info .message-meta-info .recipients {\n  color: var(--palette-text-secondary) !important;\n}\n\n/* 9. Ally & Video Playback Containers */\nhtml.bbs-dark-active .bb-video-everywhere-playback,\nhtml.bbs-dark-active .ally-wysiwyg-feedback-quill-fullscreen,\nhtml.bbs-dark-active .ally-wysiwyg-feedback-quill-fullscreen .bb-editor-root .word-count,\nhtml.bbs-dark-active .ally-wysiwyg-feedback-atto-fullscreen {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n}\n\n/* 10. Material-UI (MUI) Cards, Dialogs, Tables & Popovers */\nhtml.bbs-dark-active .MuiPaper-root,\nhtml.bbs-dark-active .MuiCard-root,\nhtml.bbs-dark-active .MuiAccordion-root {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .MuiDrawer-paper,\nhtml.bbs-dark-active .MuiDialog-paper,\nhtml.bbs-dark-active .MuiPopover-paper,\nhtml.bbs-dark-active .MuiMenu-paper {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n  border: 1px solid var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .MuiTableCell-root {\n  color: var(--palette-text-primary) !important;\n  border-bottom: 1px solid var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .MuiTableCell-head {\n  color: var(--palette-text-secondary) !important;\n  background-color: var(--palette-background-b2) !important;\n}\n\nhtml.bbs-dark-active .MuiTableRow-root:hover {\n  background-color: var(--palette-background-b3) !important;\n}\n\nhtml.bbs-dark-active .MuiOutlinedInput-root {\n  background-color: var(--palette-background-b2) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .MuiOutlinedInput-notchedOutline {\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline {\n  border-color: var(--palette-border-dark) !important;\n}\n\nhtml.bbs-dark-active .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline {\n  border-color: var(--palette-focus-main) !important;\n}\n\nhtml.bbs-dark-active .MuiInputLabel-root {\n  color: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active .MuiSelect-select {\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .MuiMenuItem-root {\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .MuiMenuItem-root:hover,\nhtml.bbs-dark-active .MuiMenuItem-root.Mui-focusVisible {\n  background-color: var(--palette-background-b3) !important;\n}\n\nhtml.bbs-dark-active .MuiMenuItem-root.Mui-selected {\n  background-color: rgba(38, 166, 154, 0.16) !important;\n  color: #26a69a !important;\n}\n\nhtml.bbs-dark-active .MuiChip-root {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .MuiTooltip-tooltip {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n  border: 1px solid var(--palette-border-main) !important;\n}\n\n/* 11. Office UI Fabric Components (Peek panels, dialogs, inputs, dropdowns) */\nhtml.bbs-dark-active .ms-Panel-main,\nhtml.bbs-dark-active .ms-Dialog-main,\nhtml.bbs-dark-active .ms-Callout-main,\nhtml.bbs-dark-active [class*=\"calloutIsIconDropdown_\"] {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .ms-Panel-header,\nhtml.bbs-dark-active .ms-Dialog-header {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .ms-TextField-fieldGroup,\nhtml.bbs-dark-active .ms-Dropdown-title,\nhtml.bbs-dark-active [class*=\"fieldGroup_\"],\nhtml.bbs-dark-active [class*=\"title_03f08ace\"],\nhtml.bbs-dark-active [class*=\"title_b5f9cc14\"] {\n  background-color: var(--palette-background-b2) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .ms-Dropdown-items,\nhtml.bbs-dark-active .ms-ContextualMenu {\n  background-color: var(--palette-background-b1) !important;\n}\n\nhtml.bbs-dark-active .ms-Dropdown-item,\nhtml.bbs-dark-active .ms-ContextualMenu-item {\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .ms-Dropdown-item:hover,\nhtml.bbs-dark-active .ms-ContextualMenu-item:hover {\n  background-color: var(--palette-background-b3) !important;\n}\n\nhtml.bbs-dark-active [class*=\"choiceField_\"]::before,\nhtml.bbs-dark-active [class*=\"field_b767b14a\"]::before {\n  background-color: var(--palette-background-b2) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active [class*=\"footer_56e96089\"] {\n  background-color: var(--palette-background-b1) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\n/* 12. Rich Text & Content Editors */\nhtml.bbs-dark-active .ql-container,\nhtml.bbs-dark-active .ql-editor,\nhtml.bbs-dark-active .bb-editor-root {\n  background-color: var(--palette-background-b2) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .ql-toolbar {\n  background-color: var(--palette-background-b3) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .ql-toolbar button,\nhtml.bbs-dark-active .ql-toolbar .ql-picker-label {\n  color: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active .ql-toolbar button:hover,\nhtml.bbs-dark-active .ql-toolbar .ql-picker-label:hover {\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .ql-snow .ql-stroke {\n  stroke: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active .ql-snow .ql-fill {\n  fill: var(--palette-text-secondary) !important;\n}\n\n/* 13. Course Content Items, Course Faculty, and To-Do Sidebar (JSS & Emotion Components) */\nhtml.bbs-dark-active .content-list-item .itemContainer,\nhtml.bbs-dark-active [class*=\"makeStylesitemContainer-\"],\nhtml.bbs-dark-active [class*=\"makeStylesfolderContents-\"],\nhtml.bbs-dark-active [class*=\"makeStyleslearningModuleContents-\"],\nhtml.bbs-dark-active [class*=\"makeStylesminiPlayer-\"],\nhtml.bbs-dark-active [class*=\"makeStyleseditBannerButton-\"],\nhtml.bbs-dark-active [class*=\"makeStylesopenStatus-\"],\nhtml.bbs-dark-active [class*=\"makeStylescolorPrimary-\"],\nhtml.bbs-dark-active [class*=\"makeStylescomboboxInputDefaultColor-\"] {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active .content-list-item .itemContainer:hover,\nhtml.bbs-dark-active [class*=\"makeStylesitemContainer-\"]:hover,\nhtml.bbs-dark-active [class*=\"makeStylesnestedItemContainer-\"]:hover {\n  background-color: var(--palette-background-b3) !important;\n}\n\nhtml.bbs-dark-active [class*=\"makeStylesparentItem-\"],\nhtml.bbs-dark-active [class*=\"makeStylesisOpen-\"],\nhtml.bbs-dark-active [class*=\"makeStyleslistWrapper-\"],\nhtml.bbs-dark-active [class*=\"makeStylescontentRoot-\"],\nhtml.bbs-dark-active [class*=\"makeStylesauthoring-\"],\nhtml.bbs-dark-active [class*=\"makeStylessubmissionValue-\"] {\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active [class*=\"makeStylescontentItemTitle-\"],\nhtml.bbs-dark-active .ax-focusable-title,\nhtml.bbs-dark-active .js-instructor-username,\nhtml.bbs-dark-active .js-instructor-username *,\nhtml.bbs-dark-active [class*=\"makeStylesusername-\"],\nhtml.bbs-dark-active [class*=\"makeStylesbaseText-\"],\nhtml.bbs-dark-active .js-send-message-link,\nhtml.bbs-dark-active [class*=\"makeStylesmessageLinkRoot-\"],\nhtml.bbs-dark-active [class*=\"makeStylesaddCourseScheduleButton-\"],\nhtml.bbs-dark-active [class*=\"makeStylessearchAction-\"],\nhtml.bbs-dark-active .peek [class*=\"makeStylesheaderText-\"],\nhtml.bbs-dark-active body:not(.is-in-mobile-app) [class*=\"makeStylesheaderText-\"] {\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active [class*=\"makeStylesgradeDetail-\"],\nhtml.bbs-dark-active [class*=\"makeStylesgradeInfo-\"],\nhtml.bbs-dark-active [class*=\"makeStylessubtext-\"],\nhtml.bbs-dark-active [class*=\"makeStyleshelpText-\"],\nhtml.bbs-dark-active [class*=\"makeStylesemptyListMessage-\"],\nhtml.bbs-dark-active [class*=\"makeStylesisRestricted-\"],\nhtml.bbs-dark-active [class*=\"makeStyleschevron-\"] {\n  color: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active .js-role-badge,\nhtml.bbs-dark-active [class*=\"makeStylesroleBadge-\"],\nhtml.bbs-dark-active [class*=\"makeStylesemptyState-\"],\nhtml.bbs-dark-active [class*=\"makeStylesautoMarked-\"],\nhtml.bbs-dark-active [class*=\"makeStylessmallScreen-\"],\nhtml.bbs-dark-active [class*=\"makeStylesdragOverlayOuter-\"] {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active [class*=\"makeStylesfooterRoot-\"],\nhtml.bbs-dark-active [class*=\"makeStylesinputContainer-\"],\nhtml.bbs-dark-active [class*=\"makeStylessubmissionContent-\"] {\n  background-color: var(--palette-background-b2) !important;\n  color: var(--palette-text-primary) !important;\n  border-color: var(--palette-border-main) !important;\n}\n\nhtml.bbs-dark-active [class*=\"makeStylesclosedStatus-\"],\nhtml.bbs-dark-active [class*=\"makeStylesinputContainerDisabled-\"] {\n  background-color: var(--palette-background-b4) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .MuiAccordionDetails-root,\nhtml.bbs-dark-active .MuiCollapse-root,\nhtml.bbs-dark-active .MuiCollapse-wrapper,\nhtml.bbs-dark-active .MuiCollapse-wrapperInner {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .MuiInputLabel-root::before,\nhtml.bbs-dark-active .MuiInputLabel-shrink::before {\n  background: transparent !important;\n}\n\n/* 14. Remaining Static CSS Hardcoded Selectors */\nhtml.bbs-dark-active .attendance-app .grid__cell,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty.-readonly,\nhtml.bbs-dark-active .rb-grid .rb-cell,\nhtml.bbs-dark-active .tabs-content,\nhtml.bbs-dark-active .grade-grid-container .overall-grade-setup,\nhtml.bbs-dark-active .typeahead-search .typeahead-search-autocomplete .typeahead-search-entry,\nhtml.bbs-dark-active .fc-unthemed .fc-popover,\nhtml.bbs-dark-active .fc-time-grid-event .fc-bg,\nhtml.bbs-dark-active .tooltip,\nhtml.bbs-dark-active span.enhanced-tooltip {\n  background-color: var(--palette-background-b1) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .attendance-app .grid__cell.-exempt,\nhtml.bbs-dark-active .attendance-app .meeting-view-cell.-empty,\nhtml.bbs-dark-active .student-submission .submission-to-grade .answer-to-grade,\nhtml.bbs-dark-active .bb-video-everywhere-playback,\nhtml.bbs-dark-active .fs-table thead,\nhtml.bbs-dark-active .fs-table tfoot,\nhtml.bbs-dark-active .fs-table tr.even,\nhtml.bbs-dark-active .fs-table tr.alt,\nhtml.bbs-dark-active .fs-table tr:nth-of-type(even) {\n  background-color: var(--palette-background-b2) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active code,\nhtml.bbs-dark-active .panel,\nhtml.bbs-dark-active .fc-state-default,\nhtml.bbs-dark-active .fc-unthemed .fc-popover .fc-header,\nhtml.bbs-dark-active .messages-container-summary .messages-header .messages-off,\nhtml.bbs-dark-active .calendar-wrapper .element-card-container,\nhtml.bbs-dark-active .attendance-app .list-row__button--excused,\nhtml.bbs-dark-active .attendance-app .list-row__button--unmarked {\n  background-color: var(--palette-background-b3) !important;\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active .wrapping-input-style,\nhtml.bbs-dark-active .wrapping-input-style input,\nhtml.bbs-dark-active .grade-callout,\nhtml.bbs-dark-active .grade-callout input {\n  color: var(--palette-text-primary) !important;\n}\n\n/* 15. Computed-Style Fallback Attributes (Set by content.js for Dynamic/Cross-Origin Elements) */\nhtml.bbs-dark-active [data-bbs-bg=\"b1\"] {\n  background-color: var(--palette-background-b1) !important;\n}\n\nhtml.bbs-dark-active [data-bbs-bg=\"b2\"] {\n  background-color: var(--palette-background-b2) !important;\n}\n\nhtml.bbs-dark-active [data-bbs-bg=\"b3\"] {\n  background-color: var(--palette-background-b3) !important;\n}\n\nhtml.bbs-dark-active [data-bbs-bg=\"b4\"] {\n  background-color: var(--palette-background-b4) !important;\n}\n\nhtml.bbs-dark-active [data-bbs-fg=\"pri\"] {\n  color: var(--palette-text-primary) !important;\n}\n\nhtml.bbs-dark-active [data-bbs-fg=\"sec\"] {\n  color: var(--palette-text-secondary) !important;\n}\n\nhtml.bbs-dark-active [data-bbs-fg=\"warn\"] {\n  color: var(--palette-urgency-high) !important;\n}\n\nhtml.bbs-dark-active [data-bbs-border=\"dark\"] {\n  border-color: var(--palette-border-main) !important;\n}\n\n/* ---- Polish (2026-10-25): states that read clearly on dark ---- */\n\n/* Main menu: the selected page is a light bar and lighter row, not white text on bright green */\nhtml.bbs-dark-active a.base-navigation-button-content.active {\n  background-color: var(--palette-background-b4) !important;\n  box-shadow: inset 3px 0 0 var(--palette-text-primary) !important;\n}\nhtml.bbs-dark-active a.base-navigation-button-content.active * {\n  color: var(--palette-text-primary) !important;\n}\n\n/* Two-way switches (Schedule / Due Dates, Day / Month): the selected half is light */\nhtml.bbs-dark-active button.active-switch,\nhtml.bbs-dark-active button.active-switch:hover {\n  background-color: var(--palette-text-primary) !important;\n  color: var(--palette-background-default) !important;\n  border-color: var(--palette-text-primary) !important;\n}\n\n/* Calendar: the selected day is a light circle */\nhtml.bbs-dark-active .fc-today.date-selected,\nhtml.bbs-dark-active button.date-selected {\n  background-color: var(--palette-text-primary) !important;\n  color: var(--palette-background-default) !important;\n  border-color: var(--palette-text-primary) !important;\n}\n\n/* Field labels on outlined inputs: no dark patch behind the label */\nhtml.bbs-dark-active .MuiOutlinedInput-notchedOutline > legend {\n  background: transparent !important;\n}\n\n/* Count badges (new announcements): light with dark text */\nhtml.bbs-dark-active .MuiBadge-badge.themed-background-primary-fill {\n  background-color: var(--palette-text-primary) !important;\n  color: var(--palette-background-default) !important;\n}\n\n/* Grade pills keep their colour; their text stays dark so it can be read */\nhtml.bbs-dark-active .customGradePill,\nhtml.bbs-dark-active .customGradePill * {\n  color: #121214 !important;\n}\n\n/* Grades page \"recently graded work will appear here\": a quiet dashed box instead of bright stripes */\nhtml.bbs-dark-active .base-grades-empty-element {\n  background-image: none !important;\n  border: 1px dashed var(--palette-border-dark) !important;\n}\n\n/* Activity items: Blackboard's hover layer and icon tile are near-white, which hides the light text and icon */\nhtml.bbs-dark-active .stream-item-container .stream-item::before {\n  background-color: var(--palette-background-b4) !important;\n}\n\nhtml.bbs-dark-active .stream-item-container .element-image,\nhtml.bbs-dark-active .child-is-invokable:hover .element-image {\n  background-color: var(--palette-background-b1) !important;\n  outline: 1px solid var(--palette-border-main);\n}\n";

  let isEnabled = true;
  let scanEpoch = 1;
  let sheetState = new WeakMap();
  let rootObserver = null;
  let domObserver = null;
  let intervalId = null;
  let rafId = null;
  let isCleanedUp = false;

  const isContextValid = () => {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };

  // Notify any previous content script instance in this tab to clean up its observers
  try {
    document.dispatchEvent(new CustomEvent('bbs-dark-reinit'));
  } catch (_) {}

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT',
    'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'PATH', 'G', 'DEFS',
    'CLIPPATH', 'LINEARGRADIENT', 'RADIALGRADIENT', 'STOP', 'CIRCLE',
    'ELLIPSE', 'LINE', 'POLYGON', 'POLYLINE', 'RECT', 'USE', 'SYMBOL',
    'IFRAME', 'OBJECT', 'EMBED'
  ]);

  // Parse rgb(...) / rgba(...) / #hex into { r, g, b, a }
  const parseColor = (str) => {
    if (!str || typeof str !== 'string') return null;
    const s = str.trim().toLowerCase();
    if (!s || s === 'transparent' || s === 'inherit' || s === 'initial' || s === 'unset' || s === 'currentcolor' || s === 'none') {
      return null;
    }
    const rgbMatch = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
    if (rgbMatch) {
      return {
        r: Math.round(parseFloat(rgbMatch[1])),
        g: Math.round(parseFloat(rgbMatch[2])),
        b: Math.round(parseFloat(rgbMatch[3])),
        a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1
      };
    }
    const hexMatch = s.match(/#([0-9a-f]{3,8})\b/);
    if (hexMatch) {
      let h = hexMatch[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length >= 6) {
        return {
          r: parseInt(h.slice(0, 2), 16),
          g: parseInt(h.slice(2, 4), 16),
          b: parseInt(h.slice(4, 6), 16),
          a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
        };
      }
    }
    if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
    if (s === 'black' || s === 'windowtext') return { r: 0, g: 0, b: 0, a: 1 };
    return null;
  };

  // Map a light background color to dark palette variable
  const mapBackground = (c) => {
    if (!c || c.a < 0.15) return null;
    const { r, g, b } = c;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const avg = (r + g + b) / 3;

    if (r >= 250 && g >= 250 && b >= 250) {
      return 'var(--palette-background-b1)'; // #18181b (white cards/surfaces)
    }
    if (r >= 243 && g >= 243 && b >= 243 && spread <= 15) {
      return 'var(--palette-background-b2)'; // #141417 (#f8f8f8 panels/sidebars)
    }
    if (r >= 230 && g >= 230 && b >= 230 && spread <= 20) {
      return 'var(--palette-background-b3)'; // #202024 (#f0f0f0 pills/empty states)
    }
    if (r >= 195 && g >= 195 && b >= 195 && spread <= 22) {
      return 'var(--palette-background-b4)'; // #27272c (#e5e5e5 / #cdcdcd)
    }
    if (avg >= 210) {
      if (r > g + 15 && r > b + 15) return 'var(--palette-error-light)';
      if (g > r + 8 && g >= b) return 'var(--palette-success-light)';
      if (r > 235 && g > 215 && b < 190) return 'var(--palette-warning-light)';
      return 'var(--palette-brand-light)';
    }
    return null;
  };

  // Map a dark text color to light readable text variable
  const mapForeground = (c, bgColor) => {
    if (!c || c.a < 0.2) return null;
    // If the same rule sets a bright saturated status/brand background (e.g. #39e379 green, #00c289 teal, #ffe300 yellow), keep dark contrast text
    if (bgColor && bgColor.a >= 0.5) {
      const bgSpread = Math.max(bgColor.r, bgColor.g, bgColor.b) - Math.min(bgColor.r, bgColor.g, bgColor.b);
      const bgAvg = (bgColor.r + bgColor.g + bgColor.b) / 3;
      if (bgSpread > 45 && bgAvg > 95 && bgAvg < 215) {
        return null;
      }
    }
    const { r, g, b } = c;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const avg = (r + g + b) / 3;

    // Dark primary text (#262626, #000000, #333333)
    if (r <= 68 && g <= 68 && b <= 68) {
      return 'var(--palette-text-primary)';
    }
    // Secondary / hint grey text (#666666, #767676, #8c8c8c)
    if (r >= 69 && r <= 145 && g >= 69 && g <= 145 && b >= 69 && b <= 145 && spread <= 22) {
      return 'var(--palette-text-secondary)';
    }
    // Urgency high / burnt orange (#7D401E, #c75000) used on To-Do calendar badges
    if (r >= 110 && r <= 205 && g >= 45 && g <= 95 && b <= 45) {
      return 'var(--palette-urgency-high)';
    }
    // Dark blue or purple links (#2073a1, #a234b5, #0054bc, #005a9e, #293a53)
    if ((b > r + 25 || r > g + 35) && avg < 155) {
      return 'var(--palette-link-active)';
    }
    return null;
  };

  // Map a light border color to dark border token
  const mapBorderColor = (c) => {
    if (!c || c.a < 0.15) return null;
    const { r, g, b } = c;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (r >= 180 && g >= 180 && b >= 180 && spread <= 25) {
      return 'var(--palette-border-main)';
    }
    return null;
  };

  // Prefix each selector in a comma-separated selector list with html.bbs-dark-active
  const scopeSelector = (selectorText) => {
    if (!selectorText) return '';
    const parts = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < selectorText.length; i++) {
      const ch = selectorText[i];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());

    return parts
      .filter(Boolean)
      .map((s) => {
        if (s.startsWith('html.bbs-dark-active')) return s;
        if (/^(html|:root)\b/i.test(s)) {
          return s.replace(/^(html|:root)/i, 'html.bbs-dark-active');
        }
        return `html.bbs-dark-active ${s}`;
      })
      .join(', ');
  };

  // Transform a single CSSStyleRule into a dark-mode override rule string (or '')
  const transformStyleRule = (rule) => {
    const sel = rule.selectorText;
    const st = rule.style;
    if (!sel || !st || st.length === 0) return '';
    if (/thumb|switch-ios|colorRect_|color-selection-live-mode/i.test(sel)) return '';

    const decls = [];
    const bgRaw = st.backgroundColor || st.background;
    const bgColor = parseColor(bgRaw);

    if (bgColor && (!st.backgroundImage || st.backgroundImage === 'none' || !st.backgroundImage.includes('url('))) {
      const mappedBg = mapBackground(bgColor);
      if (mappedBg) {
        decls.push(`background-color: ${mappedBg} !important`);
      }
    }

    if (st.backgroundImage && st.backgroundImage.includes('gradient')) {
      if (/255,\s*255,\s*255|248,\s*248,\s*248|#fff/i.test(st.backgroundImage)) {
        const darkGrad = st.backgroundImage
          .replace(/255,\s*255,\s*255/g, '24, 24, 27')
          .replace(/248,\s*248,\s*248/g, '20, 20, 23')
          .replace(/205,\s*205,\s*205/g, '63, 63, 70')
          .replace(/#ffffff\b|#fff\b/gi, '#18181b');
        decls.push(`background-image: ${darkGrad} !important`);
      }
    }

    if (st.color) {
      const fgColor = parseColor(st.color);
      const mappedFg = mapForeground(fgColor, bgColor);
      if (mappedFg) {
        decls.push(`color: ${mappedFg} !important`);
      }
    }

    // Check border colors
    const bTop = mapBorderColor(parseColor(st.borderTopColor));
    const bRight = mapBorderColor(parseColor(st.borderRightColor));
    const bBottom = mapBorderColor(parseColor(st.borderBottomColor));
    const bLeft = mapBorderColor(parseColor(st.borderLeftColor));

    if (bTop && bRight && bBottom && bLeft) {
      decls.push(`border-color: ${bTop} !important`);
    } else {
      if (bTop) decls.push(`border-top-color: ${bTop} !important`);
      if (bRight) decls.push(`border-right-color: ${bRight} !important`);
      if (bBottom) decls.push(`border-bottom-color: ${bBottom} !important`);
      if (bLeft) decls.push(`border-left-color: ${bLeft} !important`);
    }

    const bBlockStart = mapBorderColor(parseColor(st.borderBlockStartColor));
    const bBlockEnd = mapBorderColor(parseColor(st.borderBlockEndColor));
    const bInlineStart = mapBorderColor(parseColor(st.borderInlineStartColor));
    const bInlineEnd = mapBorderColor(parseColor(st.borderInlineEndColor));
    if (bBlockStart) decls.push(`border-block-start-color: ${bBlockStart} !important`);
    if (bBlockEnd) decls.push(`border-block-end-color: ${bBlockEnd} !important`);
    if (bInlineStart) decls.push(`border-inline-start-color: ${bInlineStart} !important`);
    if (bInlineEnd) decls.push(`border-inline-end-color: ${bInlineEnd} !important`);

    const outlineC = mapBorderColor(parseColor(st.outlineColor));
    if (outlineC) decls.push(`outline-color: ${outlineC} !important`);

    if (st.boxShadow && /255,\s*255,\s*255|#fff/i.test(st.boxShadow)) {
      const darkShadow = st.boxShadow
        .replace(/rgb\(\s*255,\s*255,\s*255\s*\)/gi, '#18181b')
        .replace(/#ffffff\b|#fff\b/gi, '#18181b');
      decls.push(`box-shadow: ${darkShadow} !important`);
    }

    if (decls.length === 0) return '';
    return `${scopeSelector(sel)} { ${decls.join('; ')}; }`;
  };

  // Recursively process CSSRuleList (handles standard rules and @media rules)
  const processRuleList = (rules, startIndex = 0) => {
    const out = [];
    for (let i = startIndex; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.type === 1) {
        // CSSStyleRule
        const res = transformStyleRule(rule);
        if (res) out.push(res);
      } else if (rule.type === 4 && rule.cssRules) {
        // CSSMediaRule
        const nested = processRuleList(rule.cssRules, 0);
        if (nested.length > 0) {
          out.push(`@media ${rule.conditionText || rule.media.mediaText} { ${nested.join(' ')} }`);
        }
      }
    }
    return out;
  };

  // Ensure our static dark stylesheet <style id="bbs-static-dark-rules"> exists in doc
  // This guarantees 100% parity in all iframes and survives extension reloads without tab refresh
  const ensureStaticStyleEl = (doc) => {
    if (!STATIC_DARK_CSS || STATIC_DARK_CSS.startsWith('__BBS_')) return;
    let el = doc.getElementById(STATIC_STYLE_ID);
    if (!el) {
      el = doc.createElement('style');
      el.id = STATIC_STYLE_ID;
      el.textContent = STATIC_DARK_CSS;
      (doc.head || doc.documentElement).appendChild(el);
    }
  };

  // Ensure our companion <style id="bbs-dynamic-dark-rules"> exists in doc
  const getDynamicStyleEl = (doc) => {
    let el = doc.getElementById(DYNAMIC_STYLE_ID);
    if (!el) {
      el = doc.createElement('style');
      el.id = DYNAMIC_STYLE_ID;
      (doc.head || doc.documentElement).appendChild(el);
    }
    return el;
  };

  // Scan all <style> elements in doc (JSS, Emotion speedy CSSOM, Fabric, etc.)
  const scanStyleSheetsInDoc = (doc) => {
    if (!doc || !doc.documentElement) return;
    const styleEls = doc.querySelectorAll('style');
    const newRules = [];

    for (let i = 0; i < styleEls.length; i++) {
      const styleEl = styleEls[i];
      if (styleEl.id === DYNAMIC_STYLE_ID || styleEl.id === STATIC_STYLE_ID || styleEl.id === 'uos-dynamic-dark-rules') continue;
      if (styleEl.classList.contains('vjs-styles-defaults')) continue;

      const text = styleEl.textContent || '';
      if (text.includes('color-selection-live-mode')) continue;

      let rules;
      try {
        if (!styleEl.sheet || !styleEl.sheet.cssRules) continue;
        rules = styleEl.sheet.cssRules;
      } catch (_) {
        continue;
      }

      const ruleCount = rules.length;
      const textLen = text.length;
      const prev = sheetState.get(styleEl);

      if (prev && prev.ruleCount === ruleCount && prev.textLen === textLen) {
        continue;
      }

      // If rules were appended via insertRule (like Emotion speedy mode) and textLen didn't change, scan only new rules
      const startIdx = (prev && prev.textLen === textLen && ruleCount > prev.ruleCount) ? prev.ruleCount : 0;
      const generated = processRuleList(rules, startIdx);
      if (generated.length > 0) {
        newRules.push(...generated);
      }

      sheetState.set(styleEl, { ruleCount, textLen });
    }

    if (newRules.length > 0) {
      const targetStyle = getDynamicStyleEl(doc);
      targetStyle.appendChild(doc.createTextNode('\n' + newRules.join('\n')));
    }
  };

  // Fallback computed-style attribute tagger for any element styled by cross-origin CSS or inline styles
  const scanComputedElementsInDoc = (doc) => {
    if (!isEnabled || !doc || !doc.body) return;
    const win = doc.defaultView || window;
    const elements = doc.body.querySelectorAll('*');
    const len = Math.min(elements.length, 2500);

    // Check if all <link rel="stylesheet"> in doc have finished loading
    const links = doc.querySelectorAll('link[rel="stylesheet"]');
    let allLinksLoaded = doc.readyState === 'complete';
    if (allLinksLoaded) {
      for (let k = 0; k < links.length; k++) {
        if (!links[k].sheet) {
          allLinksLoaded = false;
          break;
        }
      }
    }

    const epochPrefix = `${scanEpoch}:`;

    for (let i = 0; i < len; i++) {
      const el = elements[i];
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.id === 'bbs-floating-root' || el.id === 'bbs-toast' || el.closest?.('#bbs-floating-root, #bbs-toast')) continue;

      const cls = typeof el.className === 'string' ? el.className : '';
      const cacheKey = epochPrefix + cls;
      if (allLinksLoaded && el.dataset.bbsCls === cacheKey && el.dataset.bbsPass === '2') continue;

      if (
        cls.includes('MuiSwitch-thumb') ||
        cls.includes('thumb_') ||
        cls.includes('base-navigation-button') ||
        cls.includes('bb-close') ||
        cls.includes('colorRect_')
      ) {
        if (allLinksLoaded) {
          el.dataset.bbsCls = cacheKey;
          el.dataset.bbsPass = '2';
        }
        continue;
      }

      const cs = win.getComputedStyle(el);
      const bg = parseColor(cs.backgroundColor);

      if (bg && bg.a >= 0.5) {
        const spread = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);
        if (bg.r >= 250 && bg.g >= 250 && bg.b >= 250) {
          el.setAttribute('data-bbs-bg', 'b1');
        } else if (bg.r >= 242 && bg.g >= 242 && bg.b >= 242 && spread <= 15) {
          el.setAttribute('data-bbs-bg', 'b2');
        } else if (bg.r >= 225 && bg.g >= 225 && bg.b >= 225 && spread <= 20) {
          el.setAttribute('data-bbs-bg', 'b3');
        } else if (bg.r >= 195 && bg.g >= 195 && bg.b >= 195 && spread <= 20) {
          el.setAttribute('data-bbs-bg', 'b4');
        }
      }

      const fg = parseColor(cs.color);
      if (fg && fg.a >= 0.4) {
        // Don't override dark text if background is a bright brand/status color
        let keepDarkText = false;
        // The nearest painted background decides: dark text inside a bright grade pill or badge stays dark
        let paint = bg && bg.a >= 0.5 ? { c: bg, el } : null;
        for (let p = el.parentElement, depth = 0; !paint && p && depth < 4; p = p.parentElement, depth++) {
          const pc = parseColor(win.getComputedStyle(p).backgroundColor);
          if (pc && pc.a >= 0.5) paint = { c: pc, el: p };
        }
        if (paint && !paint.el.hasAttribute('data-bbs-bg')) {
          const c = paint.c;
          const bgSpread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
          const bgAvg = (c.r + c.g + c.b) / 3;
          if (bgSpread > 45 && bgAvg > 95 && bgAvg < 215) {
            keepDarkText = true;
          }
        }
        if (!keepDarkText) {
          const fgSpread = Math.max(fg.r, fg.g, fg.b) - Math.min(fg.r, fg.g, fg.b);
          if (fg.r <= 65 && fg.g <= 65 && fg.b <= 65) {
            el.setAttribute('data-bbs-fg', 'pri');
          } else if (fg.r >= 66 && fg.r <= 125 && fg.g >= 66 && fg.g <= 125 && fg.b >= 66 && fg.b <= 125 && fgSpread <= 20) {
            el.setAttribute('data-bbs-fg', 'sec');
          } else if (fg.r >= 110 && fg.r <= 205 && fg.g >= 45 && fg.g <= 95 && fg.b <= 45) {
            el.setAttribute('data-bbs-fg', 'warn');
          }
        }
      }

      if (cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px') {
        const bCol = parseColor(cs.borderTopWidth !== '0px' ? cs.borderTopColor : cs.borderBottomColor);
        if (bCol && mapBorderColor(bCol)) {
          el.setAttribute('data-bbs-border', 'dark');
        }
      }

      if (allLinksLoaded) {
        if (el.dataset.bbsCls === cacheKey) {
          el.dataset.bbsPass = '2';
        } else {
          el.dataset.bbsCls = cacheKey;
          el.dataset.bbsPass = '1';
        }
      }
    }
  };

  const applyThemeToDoc = (doc) => {
    if (!doc || !doc.documentElement) return;
    if (isEnabled) {
      ensureStaticStyleEl(doc);
      doc.documentElement.classList.add(THEME_CLASS);
      if (doc.body) doc.body.classList.add(THEME_CLASS);
      if (!doc.documentElement.classList.contains(LEGACY_UOS_CLASS)) {
        doc.documentElement.classList.remove(BB_DARK_CLASS);
        if (doc.body) doc.body.classList.remove(BB_DARK_CLASS);
      }
      scanStyleSheetsInDoc(doc);
      scanComputedElementsInDoc(doc);
    } else {
      doc.documentElement.classList.remove(THEME_CLASS);
      if (doc.body) doc.body.classList.remove(THEME_CLASS);
      // Only remove mode-dark if standalone uos-blackboard-dark is not actively managing it
      if (!doc.documentElement.classList.contains(LEGACY_UOS_CLASS)) {
        doc.documentElement.classList.remove(BB_DARK_CLASS);
        if (doc.body) doc.body.classList.remove(BB_DARK_CLASS);
      }
    }
  };

  const applyTheme = () => {
    if (isCleanedUp) return;
    applyThemeToDoc(document);
    try {
      document.querySelectorAll('iframe').forEach((frame) => {
        try {
          if (frame.contentDocument) {
            applyThemeToDoc(frame.contentDocument);
          }
        } catch (_) {}
      });
    } catch (_) {}
  };

  const cleanup = () => {
    isCleanedUp = true;
    if (rootObserver) {
      try { rootObserver.disconnect(); } catch (_) {}
      rootObserver = null;
    }
    if (domObserver) {
      try { domObserver.disconnect(); } catch (_) {}
      domObserver = null;
    }
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  document.addEventListener('bbs-dark-reinit', cleanup, { once: true });

  // Immediate synchronous application at document_start
  applyTheme();

  // Sync with extension storage & popup toggle
  try {
    if (isContextValid()) {
      chrome.storage.local.get(['bbs_settings', 'blackboardDarkMode', 'darkModeEnabled'], (data) => {
        let enabled = true;
        if (typeof data?.bbs_settings?.blackboardDarkMode === 'boolean') {
          enabled = data.bbs_settings.blackboardDarkMode;
        } else if (typeof data?.blackboardDarkMode === 'boolean') {
          enabled = data.blackboardDarkMode;
        } else if (typeof data?.darkModeEnabled === 'boolean') {
          enabled = data.darkModeEnabled;
        }
        if (isEnabled !== enabled) {
          isEnabled = enabled;
          scanEpoch++;
        }
        applyTheme();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (isCleanedUp) return;
        if (area === 'local') {
          let nextEnabled = null;
          if (changes.bbs_settings?.newValue?.blackboardDarkMode !== undefined) {
            nextEnabled = Boolean(changes.bbs_settings.newValue.blackboardDarkMode);
          } else if (changes.blackboardDarkMode !== undefined) {
            nextEnabled = Boolean(changes.blackboardDarkMode.newValue);
          } else if (changes.darkModeEnabled !== undefined) {
            nextEnabled = Boolean(changes.darkModeEnabled.newValue);
          }
          if (nextEnabled !== null) {
            isEnabled = nextEnabled;
            scanEpoch++;
            applyTheme();
          }
        }
      });

      chrome.runtime.onMessage.addListener((msg) => {
        if (isCleanedUp) return;
        if (msg && (msg.action === 'toggleDarkMode' || msg.type === 'TOGGLE_BLACKBOARD_DARK_MODE')) {
          isEnabled = Boolean(msg.enabled);
          scanEpoch++;
          applyTheme();
        }
      });
    }
  } catch (_) {}

  // Throttled observer to catch dynamic React/JSS/Emotion renders and SPA route changes
  const scheduleScan = () => {
    if (isCleanedUp || !isEnabled || rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      applyTheme();
    });
  };

  const initObserver = () => {
    if (isCleanedUp || !document.documentElement) return;

    rootObserver = new MutationObserver(() => {
      if (!isContextValid()) {
        cleanup();
        return;
      }
      const rootMissing = isEnabled && !document.documentElement.classList.contains(THEME_CLASS);
      const shouldDisable = !isEnabled && document.documentElement.classList.contains(THEME_CLASS);
      if (rootMissing || shouldDisable) {
        applyThemeToDoc(document);
      }
    });

    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    domObserver = new MutationObserver((mutations) => {
      if (!isContextValid()) {
        cleanup();
        return;
      }
      if (!isEnabled) return;
      let shouldRun = false;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.target && (m.target.id === DYNAMIC_STYLE_ID || m.target.id === STATIC_STYLE_ID)) continue;
        if (m.addedNodes && m.addedNodes.length > 0) {
          shouldRun = true;
          for (let j = 0; j < m.addedNodes.length; j++) {
            const node = m.addedNodes[j];
            if (node.nodeType === 1) {
              if (node.tagName === 'IFRAME') {
                node.addEventListener('load', () => {
                  scanEpoch++;
                  scheduleScan();
                }, { once: true });
              } else if (node.tagName === 'LINK' && node.rel === 'stylesheet') {
                node.addEventListener('load', () => {
                  scanEpoch++;
                  scheduleScan();
                }, { once: true });
              }
            }
          }
        }
      }
      if (shouldRun) {
        scheduleScan();
      }
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    // Periodic check for CSSOM sheet.insertRule() updates (e.g. Emotion speedy mode) & async renders
    intervalId = setInterval(() => {
      if (!isContextValid()) {
        cleanup();
        return;
      }
      if (isEnabled) {
        applyTheme();
      }
    }, 600);
  };

  if (document.documentElement) {
    initObserver();
  } else {
    document.addEventListener('DOMContentLoaded', initObserver, { once: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    scanEpoch++;
    applyTheme();
  }, { once: true });
  window.addEventListener('load', () => {
    scanEpoch++;
    applyTheme();
  }, { once: true });
})();