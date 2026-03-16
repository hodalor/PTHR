import { useMemo, useState } from 'react';
import './App.css';
import { moduleUiData, sidebarSections } from './config/moduleUiData';

const getDepartmentPrefix = (department, availableDepartments) => {
  const normalizedDepartment = String(department || '').trim().toLowerCase();
  const matchedDepartment = availableDepartments.find(
    (item) => String(item.name || '').trim().toLowerCase() === normalizedDepartment
  );
  if (matchedDepartment?.code) {
    return String(matchedDepartment.code).trim().toUpperCase().slice(0, 2);
  }
  const words = normalizedDepartment.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  }
  const fallback = normalizedDepartment.replace(/[^a-z]/g, '').slice(0, 2).toUpperCase();
  return fallback.padEnd(2, 'X');
};

const shouldDisplayField = (field, currentValues) => {
  if (!field.showWhen) {
    return true;
  }
  return String(currentValues[field.showWhen.field] || '') === String(field.showWhen.value);
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const getContractCountdown = (contractEndDate) => {
  if (!contractEndDate) {
    return null;
  }
  const today = new Date();
  const endDate = new Date(`${contractEndDate}T00:00:00`);
  if (Number.isNaN(endDate.getTime())) {
    return null;
  }
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysLeft = Math.ceil((endDate.getTime() - todayStart.getTime()) / DAY_IN_MS);
  if (daysLeft < 0) {
    const elapsed = Math.abs(daysLeft);
    return {
      type: 'expired',
      shortLabel: `Expired ${elapsed}d ago`,
      detailLabel: `Contract expired ${elapsed} day${elapsed === 1 ? '' : 's'} ago`,
    };
  }
  if (daysLeft <= 30) {
    return {
      type: 'warning',
      shortLabel: `${daysLeft}d left`,
      detailLabel: `Contract ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    };
  }
  return null;
};

const getContractDaysLeft = (contractEndDate) => {
  if (!contractEndDate) {
    return Number.POSITIVE_INFINITY;
  }
  const endDate = new Date(`${contractEndDate}T00:00:00`);
  if (Number.isNaN(endDate.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((endDate.getTime() - todayStart.getTime()) / DAY_IN_MS);
};

const formatCardDate = (value) => {
  if (!value) {
    return 'N/A';
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const fitText = (ctx, value, maxWidth) => {
  const text = String(value || '');
  if (!text) {
    return '—';
  }
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
};

const normalizeHexColor = (value, fallback = '#0a73d9') => {
  const hex = String(value || '').trim().toLowerCase();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(hex);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return hex;
  }
  return fallback;
};

const blendHexToBlack = (hex, blackRatio) => {
  const normalized = normalizeHexColor(hex);
  const ratio = Math.max(0, Math.min(1, Number(blackRatio) || 0));
  const toChannel = (index) => {
    const original = parseInt(normalized.slice(index, index + 2), 16);
    const blended = Math.round(original * (1 - ratio));
    return blended.toString(16).padStart(2, '0');
  };
  return `#${toChannel(1)}${toChannel(3)}${toChannel(5)}`;
};

const nationalIdentifierPresets = {
  ghana: {
    pensionLabel: 'SSNIT Number',
    taxLabel: 'TIN',
  },
  zambia: {
    pensionLabel: 'NAPSA Number',
    taxLabel: 'TPIN',
  },
};

const loadImageFromUrl = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = url;
  });

const getIdCardDimensions = (orientation) =>
  orientation === 'portrait'
    ? { width: 540, height: 860 }
    : { width: 860, height: 540 };

const drawRoundedRectPath = (ctx, x, y, width, height, radius) => {
  const normalizedRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + normalizedRadius, y);
  ctx.lineTo(x + width - normalizedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + normalizedRadius);
  ctx.lineTo(x + width, y + height - normalizedRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - normalizedRadius, y + height);
  ctx.lineTo(x + normalizedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - normalizedRadius);
  ctx.lineTo(x, y + normalizedRadius);
  ctx.quadraticCurveTo(x, y, x + normalizedRadius, y);
  ctx.closePath();
};

const CODE39_PATTERNS = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

const toCode39Content = (value) => {
  const normalized = String(value || '')
    .toUpperCase()
    .split('')
    .map((char) => (CODE39_PATTERNS[char] ? char : '-'))
    .join('');
  return `*${normalized || 'EMPLOYEE'}*`;
};

const drawCode39Barcode = (ctx, value, x, y, width, height, color = '#132d63') => {
  const content = toCode39Content(value);
  const tokens = [];
  for (let index = 0; index < content.length; index += 1) {
    const pattern = CODE39_PATTERNS[content[index]] || CODE39_PATTERNS['-'];
    for (let bit = 0; bit < pattern.length; bit += 1) {
      const wide = pattern[bit] === 'w';
      tokens.push({
        isBar: bit % 2 === 0,
        units: wide ? 2.8 : 1.2,
      });
    }
    if (index < content.length - 1) {
      tokens.push({ isBar: false, units: 1.2 });
    }
  }
  const totalUnits = tokens.reduce((acc, token) => acc + token.units, 0);
  if (totalUnits <= 0) {
    return;
  }
  const unitWidth = width / totalUnits;
  let cursor = x;
  ctx.fillStyle = color;
  tokens.forEach((token) => {
    const tokenWidth = token.units * unitWidth;
    if (token.isBar) {
      ctx.fillRect(cursor, y, Math.max(1, tokenWidth), height);
    }
    cursor += tokenWidth;
  });
};

const createBarcodeDataUrl = (value, width = 360, height = 56, color = '#132d63') => {
  if (typeof document === 'undefined') {
    return '';
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(String(navigator.userAgent || ''))) {
    return '';
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let ctx = null;
  try {
    ctx = canvas.getContext('2d');
  } catch (error) {
    return '';
  }
  if (!ctx) {
    return '';
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  drawCode39Barcode(ctx, value, 10, 6, width - 20, height - 16, color);
  ctx.fillStyle = color;
  ctx.font = '600 10px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(value || '').toUpperCase(), width / 2, height - 2);
  return canvas.toDataURL('image/png');
};

function App() {
  const firstModuleId = sidebarSections[0].items[0].id;
  const [activeModuleId, setActiveModuleId] = useState(firstModuleId);
  const [searchText, setSearchText] = useState('');
  const [filterValue, setFilterValue] = useState('All');
  const [statusFilterValue, setStatusFilterValue] = useState('All');
  const [employmentStageFilterValue, setEmploymentStageFilterValue] = useState('All');
  const [expiryFilterValue, setExpiryFilterValue] = useState('All');
  const [sortByValue, setSortByValue] = useState('default');
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [editRowId, setEditRowId] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [formError, setFormError] = useState('');
  const [departmentNameInput, setDepartmentNameInput] = useState('');
  const [departmentCodeInput, setDepartmentCodeInput] = useState('');
  const [departmentEditingName, setDepartmentEditingName] = useState('');
  const [departmentError, setDepartmentError] = useState('');
  const [employmentStageInput, setEmploymentStageInput] = useState('');
  const [employmentStageEditingValue, setEmploymentStageEditingValue] = useState('');
  const [employmentStageError, setEmploymentStageError] = useState('');
  const [modalState, setModalState] = useState({ mode: null, rowId: null });
  const [currencyInput, setCurrencyInput] = useState('');
  const [leaveDraft, setLeaveDraft] = useState({
    type: 'Annual',
    startDate: '',
    endDate: '',
  });
  const [appSettings, setAppSettings] = useState({
    appName: 'PTHR',
    sidebarColor: '#0a73d9',
    defaultCurrency: 'USD',
    currencies: ['USD', 'GHS', 'ZMW'],
    identifierCountry: 'ghana',
    pensionFieldLabel: nationalIdentifierPresets.ghana.pensionLabel,
    taxFieldLabel: nationalIdentifierPresets.ghana.taxLabel,
    employmentStages: ['Probation', 'Confirmed', 'Suspended', 'On Leave', 'Fired', 'Expired'],
    idCardDesign: {
      companyName: 'PTHR',
      orientation: 'landscape',
      borderRadius: 18,
      logoUrl: '',
      primaryColor: '#0f4ca3',
      secondaryColor: '#21aa9c',
    },
    departments: [
      { name: 'Human Resources', code: 'HR' },
      { name: 'Engineering', code: 'EN' },
      { name: 'Finance', code: 'FN' },
      { name: 'Operations', code: 'OP' },
    ],
  });
  const [moduleRowsState, setModuleRowsState] = useState(() =>
    Object.fromEntries(Object.entries(moduleUiData).map(([moduleId, value]) => [moduleId, value.rows]))
  );

  const isSettingsPage = activeModuleId === 'settings';
  const activeModuleConfig = isSettingsPage ? null : moduleUiData[activeModuleId];
  const rows = useMemo(
    () => (activeModuleConfig ? moduleRowsState[activeModuleId] || [] : []),
    [activeModuleConfig, activeModuleId, moduleRowsState]
  );
  const isModalOpen = modalState.mode !== null;
  const isFormModal = modalState.mode === 'form';
  const modalRow = rows.find((row) => row.id === modalState.rowId) || null;
  const appInitial = appSettings.appName.trim().charAt(0).toUpperCase() || 'P';
  const sidebarBaseColor = normalizeHexColor(appSettings.sidebarColor, '#0a73d9');
  const sidebarStyle = useMemo(
    () => ({
      '--sidebar-glow': sidebarBaseColor,
      '--sidebar-bg-top': blendHexToBlack(sidebarBaseColor, 0.62),
      '--sidebar-bg-mid': blendHexToBlack(sidebarBaseColor, 0.74),
      '--sidebar-bg-bottom': blendHexToBlack(sidebarBaseColor, 0.82),
    }),
    [sidebarBaseColor]
  );
  const activeFilterField = activeModuleConfig?.filterField || '';
  const employeeImageFields = ['passportPhoto', 'idFront', 'idBack'];
  const employeeFileFields = useMemo(
    () =>
      activeModuleConfig?.formFields
        ?.filter((field) => field.type === 'file')
        .map((field) => field.key) || [],
    [activeModuleConfig]
  );
  const tableColumns = useMemo(() => {
    if (!activeModuleConfig) {
      return [];
    }
    if (activeModuleId !== 'employee-management') {
      return activeModuleConfig.columns;
    }
    if (activeModuleConfig.columns.some((column) => column.key === 'contractAlert')) {
      return activeModuleConfig.columns;
    }
    return [
      ...activeModuleConfig.columns,
      { key: 'contractAlert', label: 'Contract Alert' },
    ];
  }, [activeModuleConfig, activeModuleId]);
  const modalContractCountdown = useMemo(() => {
    if (activeModuleId !== 'employee-management' || !modalRow) {
      return null;
    }
    return getContractCountdown(modalRow.contractEndDate);
  }, [activeModuleId, modalRow]);
  const modalPassportPhotoUrl = useMemo(() => {
    if (activeModuleId !== 'employee-management' || !modalRow) {
      return '';
    }
    const files = Array.isArray(modalRow.passportPhotoFiles) ? modalRow.passportPhotoFiles : [];
    const imageFile = files.find((file) => file.isImage);
    return imageFile?.url || modalRow.passportPhotoPreview || '';
  }, [activeModuleId, modalRow]);
  const modalBarcodeValue = useMemo(() => {
    if (activeModuleId !== 'employee-management' || !modalRow) {
      return '';
    }
    return String(modalRow.id || modalRow.fullName || 'EMPLOYEE');
  }, [activeModuleId, modalRow]);
  const modalBarcodeDataUrl = useMemo(
    () => createBarcodeDataUrl(modalBarcodeValue, 320, 44, '#132d63'),
    [modalBarcodeValue]
  );

  const totalModules = useMemo(
    () => sidebarSections.reduce((acc, section) => acc + section.items.length, 0),
    []
  );
  const totalRows = useMemo(
    () => Object.values(moduleRowsState).reduce((acc, records) => acc + records.length, 0),
    [moduleRowsState]
  );
  const activeStatusCount = useMemo(
    () =>
      Object.values(moduleRowsState)
        .flat()
        .filter((row) => String(row.status || '').toLowerCase() === 'active').length,
    [moduleRowsState]
  );

  const visibleFormFields = useMemo(() => {
    if (!activeModuleConfig) {
      return [];
    }
    return activeModuleConfig.formFields.filter((field) => shouldDisplayField(field, formValues));
  }, [activeModuleConfig, formValues]);
  const currentDepartmentOptions = useMemo(
    () => appSettings.departments.map((department) => department.name),
    [appSettings.departments]
  );
  const currentEmploymentStageOptions = useMemo(
    () => appSettings.employmentStages,
    [appSettings.employmentStages]
  );
  const getFieldLabel = (field) => {
    if (!field) {
      return '';
    }
    if (activeModuleId === 'employee-management' && field.key === 'pensionId') {
      return appSettings.pensionFieldLabel || 'Pension Number';
    }
    if (activeModuleId === 'employee-management' && field.key === 'taxId') {
      return appSettings.taxFieldLabel || 'Tax ID Number';
    }
    return field.label;
  };
  const isEmployeeModule = activeModuleId === 'employee-management';
  const employeeStatusOptions = useMemo(() => {
    if (!isEmployeeModule) {
      return ['All'];
    }
    return ['All', ...new Set(rows.map((row) => String(row.status || '').trim()).filter(Boolean))];
  }, [isEmployeeModule, rows]);
  const employeeStageOptions = useMemo(() => {
    if (!isEmployeeModule) {
      return ['All'];
    }
    return ['All', ...new Set(rows.map((row) => String(row.employmentState || '').trim()).filter(Boolean))];
  }, [isEmployeeModule, rows]);
  const leaveRows = useMemo(() => moduleRowsState['leave-management'] || [], [moduleRowsState]);
  const employeeLeaveRequests = useMemo(() => {
    if (!isEmployeeModule || !modalRow) {
      return [];
    }
    return leaveRows
      .filter((leaveRow) => String(leaveRow.employee) === String(modalRow.fullName))
      .sort((a, b) => new Date(b.startDate || '1900-01-01').getTime() - new Date(a.startDate || '1900-01-01').getTime());
  }, [isEmployeeModule, leaveRows, modalRow]);

  const filterOptions = useMemo(() => {
    if (!activeModuleConfig) {
      return ['All'];
    }
    const optionValues = [...new Set(rows.map((row) => row[activeFilterField]).filter(Boolean))];
    return ['All', ...optionValues];
  }, [activeFilterField, activeModuleConfig, rows]);

  const filteredRows = useMemo(() => {
    if (!activeModuleConfig) {
      return [];
    }
    const query = searchText.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const matchesSearch =
        query.length === 0 ||
        Object.values(row).some((value) => String(value).toLowerCase().includes(query));
      const matchesFilter = filterValue === 'All' || String(row[activeFilterField]) === String(filterValue);
      if (!isEmployeeModule) {
        return matchesSearch && matchesFilter;
      }
      const matchesStatus = statusFilterValue === 'All' || String(row.status) === String(statusFilterValue);
      const matchesEmploymentStage =
        employmentStageFilterValue === 'All' || String(row.employmentState) === String(employmentStageFilterValue);
      const daysLeft = getContractDaysLeft(row.contractEndDate);
      const matchesExpiryFilter =
        expiryFilterValue === 'All' ||
        (expiryFilterValue === 'within30' && Number.isFinite(daysLeft) && daysLeft >= 0 && daysLeft <= 30) ||
        (expiryFilterValue === 'after30' && Number.isFinite(daysLeft) && daysLeft > 30) ||
        (expiryFilterValue === 'expired' && Number.isFinite(daysLeft) && daysLeft < 0) ||
        (expiryFilterValue === 'no-end-date' && !Number.isFinite(daysLeft));
      return matchesSearch && matchesFilter && matchesStatus && matchesEmploymentStage && matchesExpiryFilter;
    });
    if (!isEmployeeModule || sortByValue === 'default') {
      return filtered;
    }
    if (sortByValue === 'expiry-priority') {
      return [...filtered].sort((a, b) => {
        const aDays = getContractDaysLeft(a.contractEndDate);
        const bDays = getContractDaysLeft(b.contractEndDate);
        const aBucket = !Number.isFinite(aDays) ? 3 : aDays < 0 ? 0 : aDays <= 30 ? 1 : 2;
        const bBucket = !Number.isFinite(bDays) ? 3 : bDays < 0 ? 0 : bDays <= 30 ? 1 : 2;
        if (aBucket !== bBucket) {
          return aBucket - bBucket;
        }
        return aDays - bDays;
      });
    }
    if (sortByValue === 'closest-expiry') {
      return [...filtered].sort(
        (a, b) => getContractDaysLeft(a.contractEndDate) - getContractDaysLeft(b.contractEndDate)
      );
    }
    return filtered;
  }, [
    activeFilterField,
    activeModuleConfig,
    employmentStageFilterValue,
    expiryFilterValue,
    filterValue,
    isEmployeeModule,
    rows,
    searchText,
    sortByValue,
    statusFilterValue,
  ]);

  const closeModal = () => {
    setModalState({ mode: null, rowId: null });
    setEditRowId(null);
    setFormValues({});
    setFormError('');
  };

  const handleModuleChange = (moduleId) => {
    setActiveModuleId(moduleId);
    setSearchText('');
    setFilterValue('All');
    setStatusFilterValue('All');
    setEmploymentStageFilterValue('All');
    setExpiryFilterValue('All');
    setSortByValue('default');
    setSelectedRowId(null);
    closeModal();
  };

  const openDetails = (rowId) => {
    setSelectedRowId(rowId);
    setModalState({ mode: 'details', rowId });
    setLeaveDraft({
      type: 'Annual',
      startDate: '',
      endDate: '',
    });
  };

  const startCreate = () => {
    setEditRowId('new');
    setFormValues({});
    setFormError('');
    setModalState({ mode: 'form', rowId: null });
  };

  const startEdit = (row) => {
    setEditRowId(row.id);
    setFormValues({ ...row });
    setFormError('');
    setModalState({ mode: 'form', rowId: row.id });
  };

  const handleEmployeeLeaveDraftChange = (key, value) => {
    setLeaveDraft((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSubmitEmployeeLeaveRequest = () => {
    if (!modalRow || !isEmployeeModule) {
      return;
    }
    const normalizedType = String(leaveDraft.type || '').trim();
    const normalizedStartDate = String(leaveDraft.startDate || '').trim();
    const normalizedEndDate = String(leaveDraft.endDate || '').trim();
    if (!normalizedType || !normalizedStartDate || !normalizedEndDate) {
      setFormError('Leave type, start date, and end date are required.');
      return;
    }
    if (new Date(`${normalizedEndDate}T00:00:00`).getTime() < new Date(`${normalizedStartDate}T00:00:00`).getTime()) {
      setFormError('Leave end date cannot be before start date.');
      return;
    }
    setFormError('');
    setModuleRowsState((prev) => {
      const leaveRequests = prev['leave-management'] || [];
      const highestId = leaveRequests.reduce((acc, leaveRow) => {
        const match = String(leaveRow.id || '').match(/(\d+)$/);
        if (!match) {
          return acc;
        }
        return Math.max(acc, Number(match[1]));
      }, 0);
      const newLeaveRequest = {
        id: `LEV-${String(highestId + 1).padStart(3, '0')}`,
        employee: modalRow.fullName || modalRow.name || modalRow.id,
        type: normalizedType,
        startDate: normalizedStartDate,
        endDate: normalizedEndDate,
        status: 'Pending',
      };
      return {
        ...prev,
        'leave-management': [newLeaveRequest, ...leaveRequests],
      };
    });
    setLeaveDraft({
      type: 'Annual',
      startDate: '',
      endDate: '',
    });
  };

  const handleUpdateLeaveStatus = (leaveId, nextStatus) => {
    setModuleRowsState((prev) => ({
      ...prev,
      'leave-management': (prev['leave-management'] || []).map((leaveRow) =>
        leaveRow.id === leaveId ? { ...leaveRow, status: nextStatus } : leaveRow
      ),
      'employee-management': nextStatus === 'Approved'
        ? (prev['employee-management'] || []).map((employeeRow) =>
            employeeRow.id === modalRow?.id ? { ...employeeRow, employmentState: 'On Leave' } : employeeRow
          )
        : prev['employee-management'],
    }));
  };

  const handleDelete = (rowId) => {
    setModuleRowsState((prev) => ({
      ...prev,
      [activeModuleId]: prev[activeModuleId].filter((row) => row.id !== rowId),
    }));
    if (selectedRowId === rowId) {
      setSelectedRowId(null);
    }
    if (editRowId === rowId || modalState.rowId === rowId) {
      closeModal();
    }
  };

  const handleSave = () => {
    if (!activeModuleConfig) {
      return;
    }
    const missingRequiredField = visibleFormFields.find(
      (field) => field.required && !String(formValues[field.key] || '').trim()
    );
    if (missingRequiredField) {
      setFormError(`${getFieldLabel(missingRequiredField)} is required.`);
      return;
    }
    if (activeModuleId === 'employee-management') {
      const normalizedPassword = String(formValues.password || '').trim();
      const hasLetter = /[A-Za-z]/.test(normalizedPassword);
      const hasNumber = /\d/.test(normalizedPassword);
      if (normalizedPassword.length < 8 || !hasLetter || !hasNumber) {
        setFormError('Portal Password must be at least 8 characters and include letters and numbers.');
        return;
      }
    }

    const payload = activeModuleConfig.formFields.reduce(
      (acc, field) => ({
        ...acc,
        [field.key]: formValues[field.key] || '',
      }),
      {}
    );
    const employeeImagePreviewsPayload =
      activeModuleId === 'employee-management'
        ? employeeImageFields.reduce(
            (acc, key) => ({
              ...acc,
              [`${key}Preview`]: formValues[`${key}Preview`] || '',
            }),
            {}
          )
        : {};
    const employeeFilesPayload =
      activeModuleId === 'employee-management'
        ? employeeFileFields.reduce(
            (acc, key) => ({
              ...acc,
              [`${key}Files`]: Array.isArray(formValues[`${key}Files`])
                ? formValues[`${key}Files`]
                : [],
            }),
            {}
          )
        : {};
    const moduleIdPrefix = activeModuleId.slice(0, 3).toUpperCase();
    const fallbackId = `${moduleIdPrefix}-${Math.floor(Math.random() * 900 + 100)}`;
    let employeeGeneratedId = '';

    if (activeModuleId === 'employee-management' && editRowId === 'new') {
      const prefix = getDepartmentPrefix(payload.department, appSettings.departments);
      const currentEmployeeRows = moduleRowsState['employee-management'] || [];
      const highestSequenceForDepartment = currentEmployeeRows
        .filter((row) => row.department === payload.department)
        .reduce((acc, row) => {
        const match = String(row.id || '').match(/(\d{8})$/);
        if (!match) {
          return acc;
        }
        return Math.max(acc, Number(match[1]));
      }, 0);
      employeeGeneratedId = `${prefix}${String(highestSequenceForDepartment + 1).padStart(8, '0')}`;
    }

    const rowWithId = {
      ...payload,
      ...employeeImagePreviewsPayload,
      ...employeeFilesPayload,
      id:
        editRowId === 'new'
          ? activeModuleId === 'employee-management'
            ? employeeGeneratedId
            : formValues.id || fallbackId
          : formValues.id || editRowId,
    };

    setModuleRowsState((prev) => {
      if (editRowId === 'new') {
        return {
          ...prev,
          [activeModuleId]: [rowWithId, ...prev[activeModuleId]],
        };
      }
      return {
        ...prev,
        [activeModuleId]: prev[activeModuleId].map((row) => (row.id === editRowId ? rowWithId : row)),
      };
    });
    setSelectedRowId(rowWithId.id);
    closeModal();
  };

  const handleAddCurrency = () => {
    const normalizedCurrency = currencyInput.trim().toUpperCase();
    if (!normalizedCurrency) {
      return;
    }
    setAppSettings((prev) => {
      if (prev.currencies.includes(normalizedCurrency)) {
        return prev;
      }
      const updatedCurrencies = [...prev.currencies, normalizedCurrency];
      return {
        ...prev,
        currencies: updatedCurrencies,
        defaultCurrency: prev.defaultCurrency || updatedCurrencies[0],
      };
    });
    setCurrencyInput('');
  };

  const handleRemoveCurrency = (currency) => {
    setAppSettings((prev) => {
      if (prev.currencies.length === 1) {
        return prev;
      }
      const updatedCurrencies = prev.currencies.filter((item) => item !== currency);
      return {
        ...prev,
        currencies: updatedCurrencies,
        defaultCurrency:
          prev.defaultCurrency === currency ? updatedCurrencies[0] || '' : prev.defaultCurrency,
      };
    });
  };

  const resetDepartmentForm = () => {
    setDepartmentNameInput('');
    setDepartmentCodeInput('');
    setDepartmentEditingName('');
    setDepartmentError('');
  };

  const handleAddOrUpdateDepartment = () => {
    const normalizedName = departmentNameInput.trim();
    const normalizedCode = (departmentCodeInput.trim() || normalizedName.slice(0, 2))
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 2);

    if (!normalizedName || normalizedCode.length < 2) {
      setDepartmentError('Department name and 2-letter prefix are required.');
      return;
    }

    const existingByName = appSettings.departments.find(
      (department) =>
        department.name.toLowerCase() === normalizedName.toLowerCase() &&
        department.name.toLowerCase() !== departmentEditingName.toLowerCase()
    );
    if (existingByName) {
      setDepartmentError('Department name already exists.');
      return;
    }

    const existingByCode = appSettings.departments.find(
      (department) =>
        department.code.toLowerCase() === normalizedCode.toLowerCase() &&
        department.name.toLowerCase() !== departmentEditingName.toLowerCase()
    );
    if (existingByCode) {
      setDepartmentError('Department prefix already exists.');
      return;
    }

    if (departmentEditingName) {
      setAppSettings((prev) => ({
        ...prev,
        departments: prev.departments.map((department) =>
          department.name === departmentEditingName
            ? { ...department, name: normalizedName, code: normalizedCode }
            : department
        ),
      }));
      setModuleRowsState((prev) => ({
        ...prev,
        'employee-management': (prev['employee-management'] || []).map((row) =>
          row.department === departmentEditingName ? { ...row, department: normalizedName } : row
        ),
      }));
      if (formValues.department === departmentEditingName) {
        setFormValues((prev) => ({ ...prev, department: normalizedName }));
      }
    } else {
      setAppSettings((prev) => ({
        ...prev,
        departments: [...prev.departments, { name: normalizedName, code: normalizedCode }],
      }));
    }

    resetDepartmentForm();
  };

  const handleEditDepartment = (department) => {
    setDepartmentEditingName(department.name);
    setDepartmentNameInput(department.name);
    setDepartmentCodeInput(department.code);
    setDepartmentError('');
  };

  const handleDeleteDepartment = (departmentName) => {
    if (appSettings.departments.length === 1) {
      setDepartmentError('At least one department must remain.');
      return;
    }
    const isDepartmentUsed = (moduleRowsState['employee-management'] || []).some(
      (row) => row.department === departmentName
    );
    if (isDepartmentUsed) {
      setDepartmentError('Cannot delete a department that has employee records.');
      return;
    }
    setAppSettings((prev) => ({
      ...prev,
      departments: prev.departments.filter((department) => department.name !== departmentName),
    }));
    if (formValues.department === departmentName) {
      setFormValues((prev) => ({ ...prev, department: '' }));
    }
    if (departmentEditingName === departmentName) {
      resetDepartmentForm();
    }
  };

  const resetEmploymentStageForm = () => {
    setEmploymentStageInput('');
    setEmploymentStageEditingValue('');
    setEmploymentStageError('');
  };

  const handleAddOrUpdateEmploymentStage = () => {
    const normalizedStage = employmentStageInput.trim();
    if (!normalizedStage) {
      setEmploymentStageError('Employment stage is required.');
      return;
    }

    const duplicateStage = appSettings.employmentStages.find(
      (stage) =>
        stage.toLowerCase() === normalizedStage.toLowerCase() &&
        stage.toLowerCase() !== employmentStageEditingValue.toLowerCase()
    );
    if (duplicateStage) {
      setEmploymentStageError('Employment stage already exists.');
      return;
    }

    if (employmentStageEditingValue) {
      setAppSettings((prev) => ({
        ...prev,
        employmentStages: prev.employmentStages.map((stage) =>
          stage === employmentStageEditingValue ? normalizedStage : stage
        ),
      }));
      setModuleRowsState((prev) => ({
        ...prev,
        'employee-management': (prev['employee-management'] || []).map((row) =>
          row.employmentState === employmentStageEditingValue
            ? { ...row, employmentState: normalizedStage }
            : row
        ),
      }));
      if (formValues.employmentState === employmentStageEditingValue) {
        setFormValues((prev) => ({ ...prev, employmentState: normalizedStage }));
      }
    } else {
      setAppSettings((prev) => ({
        ...prev,
        employmentStages: [...prev.employmentStages, normalizedStage],
      }));
    }

    resetEmploymentStageForm();
  };

  const handleEditEmploymentStage = (stage) => {
    setEmploymentStageEditingValue(stage);
    setEmploymentStageInput(stage);
    setEmploymentStageError('');
  };

  const handleDeleteEmploymentStage = (stage) => {
    if (appSettings.employmentStages.length === 1) {
      setEmploymentStageError('At least one employment stage must remain.');
      return;
    }
    const isStageUsed = (moduleRowsState['employee-management'] || []).some(
      (row) => row.employmentState === stage
    );
    if (isStageUsed) {
      setEmploymentStageError('Cannot delete a stage that has employee records.');
      return;
    }
    setAppSettings((prev) => ({
      ...prev,
      employmentStages: prev.employmentStages.filter((item) => item !== stage),
    }));
    if (formValues.employmentState === stage) {
      setFormValues((prev) => ({ ...prev, employmentState: '' }));
    }
    if (employmentStageEditingValue === stage) {
      resetEmploymentStageForm();
    }
  };

  const handleDownloadEmployeeId = async (employeeRow, side) => {
    if (!employeeRow) {
      return;
    }
    const cardOrientation = appSettings.idCardDesign?.orientation || 'landscape';
    const companyName = appSettings.idCardDesign?.companyName || appSettings.appName || 'PTHR';
    const primaryColor = appSettings.idCardDesign?.primaryColor || '#0f4ca3';
    const secondaryColor = appSettings.idCardDesign?.secondaryColor || '#21aa9c';
    const logoUrl = appSettings.idCardDesign?.logoUrl || '';
    const borderRadius = Math.max(
      0,
      Math.min(50, Number(appSettings.idCardDesign?.borderRadius) || 0)
    );
    const { width, height } = getIdCardDimensions(cardOrientation);
    const isPortrait = cardOrientation === 'portrait';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const photoFiles = Array.isArray(employeeRow.passportPhotoFiles) ? employeeRow.passportPhotoFiles : [];
    const photoFile = photoFiles.find((file) => file.isImage);
    const photoUrl = photoFile?.url || employeeRow.passportPhotoPreview || '';
    const expiryText = formatCardDate(employeeRow.contractEndDate);
    const barcodeValue = String(employeeRow.id || employeeRow.fullName || 'EMPLOYEE');
    const emergencyContact = `${employeeRow.emergencyContact1Name || 'N/A'} • ${
      employeeRow.emergencyContact1Phone || 'N/A'
    }`;
    const cardSide = side === 'back' ? 'back' : 'front';
    const titleText = cardSide === 'back' ? 'OFFICIAL BACK' : 'EMPLOYEE ID CARD';
    const logoImage = logoUrl
      ? await loadImageFromUrl(logoUrl).catch(() => null)
      : null;
    const photoImage = photoUrl
      ? await loadImageFromUrl(photoUrl).catch(() => null)
      : null;

    drawRoundedRectPath(ctx, 0, 0, width, height, borderRadius);
    ctx.clip();

    const baseGradient = ctx.createLinearGradient(0, 0, width, height);
    baseGradient.addColorStop(0, '#ffffff');
    baseGradient.addColorStop(1, '#f4f9ff');
    ctx.fillStyle = baseGradient;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#bcd3f3';
    ctx.lineWidth = Math.max(2, Math.round(width * 0.003));
    drawRoundedRectPath(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth, borderRadius);
    ctx.stroke();

    const headerHeight = Math.round(height * 0.14);
    const subheadHeight = Math.round(height * 0.095);
    const footerHeight = cardSide === 'front' ? Math.round(height * 0.155) : 0;
    const bodyY = headerHeight + subheadHeight;
    const bodyHeight = height - bodyY - footerHeight;
    const bodyPadding = Math.round(width * 0.03);
    const contentWidth = width - bodyPadding * 2;
    const accentGradient = ctx.createLinearGradient(0, 0, width, 0);
    accentGradient.addColorStop(0, primaryColor);
    accentGradient.addColorStop(1, secondaryColor);

    ctx.fillStyle = accentGradient;
    ctx.fillRect(0, 0, width, headerHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${isPortrait ? 24 : 26}px "Segoe UI", Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(titleText, bodyPadding, Math.round(height * 0.028));
    ctx.font = `700 ${isPortrait ? 16 : 17}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(companyName, bodyPadding, Math.round(height * 0.078));

    if (logoImage) {
      const logoBoxHeight = isPortrait ? 42 : 34;
      const logoRatio = logoImage.width > 0 && logoImage.height > 0 ? logoImage.width / logoImage.height : 1;
      const logoWidth = Math.min(isPortrait ? 108 : 112, logoBoxHeight * logoRatio);
      const logoX = width - bodyPadding - logoWidth;
      const logoY = Math.round(height * 0.03);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      drawRoundedRectPath(ctx, logoX - 5, logoY - 3, logoWidth + 10, logoBoxHeight + 6, 8);
      ctx.fill();
      ctx.drawImage(logoImage, logoX, logoY, logoWidth, logoBoxHeight);
    }

    ctx.fillStyle = '#e8edf6';
    ctx.fillRect(0, headerHeight, width, subheadHeight);
    ctx.fillStyle = '#37517e';
    ctx.font = `700 ${isPortrait ? 14 : 16}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(
      fitText(ctx, String(employeeRow.department || 'Department').toUpperCase(), width - bodyPadding * 2),
      bodyPadding,
      headerHeight + Math.round(subheadHeight * 0.25)
    );

    const drawInfoRows = (rows, startX, startY, maxValueWidth, rowGap, variant = 'default') => {
      const labelSize = variant === 'compact' ? (isPortrait ? 12 : 11) : isPortrait ? 13 : 12;
      const valueSize = variant === 'compact' ? (isPortrait ? 19 : 17) : isPortrait ? 21 : 20;
      const valueOffset = variant === 'compact' ? (isPortrait ? 14 : 12) : isPortrait ? 18 : 16;
      rows.forEach(([label, value], index) => {
        const y = startY + index * rowGap;
        ctx.fillStyle = '#6780ab';
        ctx.font = `600 ${labelSize}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(String(label).toUpperCase(), startX, y);
        ctx.fillStyle = '#1c376e';
        ctx.font = `700 ${valueSize}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(fitText(ctx, value, maxValueWidth), startX, y + valueOffset);
      });
    };

    if (cardSide === 'front') {
      const photoBoxWidth = isPortrait ? Math.round(contentWidth * 0.58) : Math.round(contentWidth * 0.3);
      const photoBoxHeight = isPortrait ? Math.round(bodyHeight * 0.27) : Math.round(bodyHeight * 0.82);
      const photoX = isPortrait ? Math.round((width - photoBoxWidth) / 2) : bodyPadding;
      const photoY = bodyY + Math.round(height * 0.03);

      ctx.fillStyle = '#e7f1ff';
      ctx.strokeStyle = '#cad9ef';
      ctx.lineWidth = 1.4;
      drawRoundedRectPath(ctx, photoX, photoY, photoBoxWidth, photoBoxHeight, 14);
      ctx.fill();
      ctx.stroke();

      if (photoImage) {
        ctx.drawImage(photoImage, photoX + 1, photoY + 1, photoBoxWidth - 2, photoBoxHeight - 2);
      } else {
        ctx.fillStyle = '#56739d';
        ctx.font = `700 ${isPortrait ? 17 : 16}px "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('PHOTO', photoX + photoBoxWidth / 2, photoY + photoBoxHeight / 2 - 10);
        ctx.textAlign = 'left';
      }

      const rows = [
        ['Name', employeeRow.fullName || '—'],
        ['Position', employeeRow.position || '—'],
        ['Employee Number', employeeRow.id || '—'],
        ['Date of Expiry', expiryText],
      ];

      if (isPortrait) {
        const rowStartY = photoY + photoBoxHeight + Math.round(height * 0.03);
        drawInfoRows(rows, bodyPadding, rowStartY, width - bodyPadding * 2, Math.round(height * 0.073));
      } else {
        const infoX = photoX + photoBoxWidth + Math.round(width * 0.02);
        const maxValueWidth = width - infoX - bodyPadding;
        const rowGap = Math.max(42, Math.round(photoBoxHeight * 0.2));
        drawInfoRows(rows, infoX, photoY + 2, maxValueWidth, rowGap, 'compact');
      }

      const footerY = height - footerHeight;
      ctx.fillStyle = '#f7fbff';
      ctx.fillRect(0, footerY, width, footerHeight);
      ctx.fillStyle = '#d9e4f8';
      ctx.fillRect(0, footerY, width, 2);

      const barcodeWidth = isPortrait ? Math.round(width * 0.72) : Math.round(width * 0.45);
      const barcodeHeight = isPortrait ? Math.round(footerHeight * 0.36) : Math.round(footerHeight * 0.42);
      const barcodeX = Math.round((width - barcodeWidth) / 2);
      const barcodeY = footerY + Math.round(footerHeight * 0.25);
      drawCode39Barcode(ctx, barcodeValue, barcodeX, barcodeY, barcodeWidth, barcodeHeight, '#132d63');
      ctx.fillStyle = '#132d63';
      ctx.font = `600 ${isPortrait ? 11 : 10}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(barcodeValue.toUpperCase(), width / 2, barcodeY + barcodeHeight + 12);
      ctx.textAlign = 'left';
    } else {
      const rows = [
        ['ID', employeeRow.id || '—'],
        ['Name', employeeRow.fullName || '—'],
        ['Department', employeeRow.department || '—'],
        ['Emergency Contact', emergencyContact],
        ['Expiry', expiryText],
      ];
      const rowStartX = bodyPadding;
      const rowStartY = bodyY + Math.round(height * 0.03);
      const rowGap = Math.round(height * 0.102);

      let valueWidth = width - bodyPadding * 2;
      if (logoImage) {
        valueWidth = width - bodyPadding * 2 - (isPortrait ? 130 : 110);
      }
      drawInfoRows(rows, rowStartX, rowStartY, valueWidth, rowGap);

      if (logoImage) {
        const bodyLogoHeight = isPortrait ? 58 : 46;
        const bodyLogoRatio = logoImage.width > 0 && logoImage.height > 0 ? logoImage.width / logoImage.height : 1;
        const bodyLogoWidth = Math.min(isPortrait ? 140 : 124, bodyLogoHeight * bodyLogoRatio);
        const bodyLogoX = width - bodyPadding - bodyLogoWidth;
        const bodyLogoY = rowStartY + Math.round(height * 0.03);
        ctx.fillStyle = '#f7fbff';
        drawRoundedRectPath(ctx, bodyLogoX - 6, bodyLogoY - 4, bodyLogoWidth + 12, bodyLogoHeight + 8, 8);
        ctx.fill();
        ctx.strokeStyle = '#cad9ef';
        ctx.lineWidth = 1;
        drawRoundedRectPath(ctx, bodyLogoX - 6, bodyLogoY - 4, bodyLogoWidth + 12, bodyLogoHeight + 8, 8);
        ctx.stroke();
        ctx.drawImage(logoImage, bodyLogoX, bodyLogoY, bodyLogoWidth, bodyLogoHeight);
      }

      const footerAreaY = bodyY + Math.round(bodyHeight * 0.76);
      const qrSize = isPortrait ? 90 : 72;
      const qrX = bodyPadding;
      const qrY = footerAreaY;
      ctx.fillStyle = '#132d63';
      ctx.fillRect(qrX, qrY, qrSize, qrSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(qrX + 10, qrY + 10, qrSize - 20, qrSize - 20);
      ctx.fillStyle = '#132d63';
      for (let i = 0; i < 10; i += 1) {
        const px = qrX + 14 + ((i * 9) % (qrSize - 28));
        const py = qrY + 14 + ((i * 11) % (qrSize - 28));
        const sq = i % 2 === 0 ? 9 : 6;
        ctx.fillRect(px, py, sq, sq);
      }

      const signatureX = qrX + qrSize + Math.round(width * 0.03);
      const signatureWidth = width - signatureX - bodyPadding;
      const signatureTop = qrY + Math.round(qrSize * 0.55);
      ctx.strokeStyle = '#bfd0ef';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(signatureX, signatureTop);
      ctx.lineTo(signatureX + signatureWidth * 0.46, signatureTop);
      ctx.moveTo(signatureX + signatureWidth * 0.54, signatureTop);
      ctx.lineTo(signatureX + signatureWidth, signatureTop);
      ctx.stroke();
      ctx.fillStyle = '#6780ab';
      ctx.font = `700 ${isPortrait ? 11 : 10}px "Segoe UI", Arial, sans-serif`;
      ctx.fillText('EMPLOYEE SIGNATURE', signatureX + 4, signatureTop + 6);
      ctx.fillText('HR MANAGER', signatureX + signatureWidth * 0.56, signatureTop + 6);
    }

    const fileNameBase = String(employeeRow.fullName || employeeRow.id || 'employee')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'employee';
    const downloadLink = document.createElement('a');
    downloadLink.href = canvas.toDataURL('image/png');
    downloadLink.download =
      cardSide === 'back' ? `${fileNameBase}-employee-id-back.png` : `${fileNameBase}-employee-id.png`;
    downloadLink.click();
  };

  const handleIdCardLogoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAppSettings((prev) => ({
        ...prev,
        idCardDesign: {
          ...prev.idCardDesign,
          logoUrl: String(reader.result || ''),
        },
      }));
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleDownloadBothEmployeeIdSides = async (employeeRow) => {
    await handleDownloadEmployeeId(employeeRow, 'front');
    await handleDownloadEmployeeId(employeeRow, 'back');
  };

  return (
    <div className="App">
      <aside className="sidebar-shell" style={sidebarStyle}>
        <div className="brand-block">
          <div className="brand-logo">{appInitial}</div>
          <div>
            <h1>{appSettings.appName || 'PTHR'}</h1>
            <p>HR Command Center</p>
          </div>
        </div>
        {sidebarSections.map((section) => (
          <div className="sidebar-section" key={section.title}>
            <h2>{section.title}</h2>
            <nav>
              {section.items.map((item) => (
                <button key={item.id} type="button" className={`menu-item ${activeModuleId === item.id ? 'active' : ''}`} onClick={() => handleModuleChange(item.id)}>
                  <span>{item.label}</span>
                  {Array.isArray(item.children) && item.children.length > 0 ? <span className="menu-arrow">▾</span> : null}
                </button>
              ))}
            </nav>
          </div>
        ))}
      </aside>

      <div className="app-shell">
        <header className="hero">
          <div>
            <h1>{appSettings.appName || 'PTHR'} HR Management Workspace</h1>
            <p>Complete UI implementation with CRUD actions, enterprise data tables, and smart filters.</p>
          </div>
          <div className="stats">
            <article className="stat-card">
              <span className="stat-value">{totalModules}</span>
              <span className="stat-label">Modules</span>
            </article>
            <article className="stat-card">
              <span className="stat-value">{totalRows}</span>
              <span className="stat-label">Data Rows</span>
            </article>
            <article className="stat-card">
              <span className="stat-value">{activeStatusCount}</span>
              <span className="stat-label">Active Records</span>
            </article>
          </div>
        </header>

        <main className="content-grid">
          {isSettingsPage ? (
            <section className="panel settings-panel">
              <div className="panel-title-row">
                <div>
                  <h2>Settings</h2>
                  <p>Manage app values, departments, employment stages, and ID card design</p>
                </div>
              </div>
              <div className="settings-grid">
                <label>
                  <span>Application Name</span>
                  <input
                    value={appSettings.appName}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        appName: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Default Currency</span>
                  <select
                    className="filter-select"
                    value={appSettings.defaultCurrency}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        defaultCurrency: event.target.value,
                      }))
                    }
                  >
                    {appSettings.currencies.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Sidebar Color</span>
                  <input
                    type="color"
                    value={sidebarBaseColor}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        sidebarColor: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Employee ID Label Preset</span>
                  <select
                    className="filter-select"
                    value={appSettings.identifierCountry}
                    onChange={(event) =>
                      setAppSettings((prev) => {
                        const nextCountry = event.target.value === 'zambia' ? 'zambia' : 'ghana';
                        const preset = nationalIdentifierPresets[nextCountry];
                        return {
                          ...prev,
                          identifierCountry: nextCountry,
                          pensionFieldLabel: preset.pensionLabel,
                          taxFieldLabel: preset.taxLabel,
                        };
                      })
                    }
                  >
                    <option value="ghana">Ghana (SSNIT/TIN)</option>
                    <option value="zambia">Zambia (NAPSA/TPIN)</option>
                  </select>
                </label>
                <label>
                  <span>Employee Pension Field Label</span>
                  <input
                    value={appSettings.pensionFieldLabel}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        pensionFieldLabel: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Employee Tax Field Label</span>
                  <input
                    value={appSettings.taxFieldLabel}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        taxFieldLabel: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Add Currency</span>
                  <div className="inline-field">
                    <input
                      placeholder="e.g. NGN"
                      value={currencyInput}
                      onChange={(event) => setCurrencyInput(event.target.value)}
                    />
                    <button type="button" className="primary-btn" onClick={handleAddCurrency}>
                      Add
                    </button>
                  </div>
                </label>
                <div>
                  <span className="field-title">Available Currencies</span>
                  <div className="currency-list">
                    {appSettings.currencies.map((currency) => (
                      <div key={currency} className="currency-chip">
                        <span>{currency}</span>
                        <button
                          type="button"
                          className="mini-btn danger"
                          onClick={() => handleRemoveCurrency(currency)}
                          disabled={appSettings.currencies.length === 1}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="settings-divider" />
                <label>
                  <span>{departmentEditingName ? 'Edit Department' : 'Add Department'}</span>
                  <div className="inline-field">
                    <input
                      placeholder="Department name"
                      value={departmentNameInput}
                      onChange={(event) => setDepartmentNameInput(event.target.value)}
                    />
                    <input
                      className="department-code-input"
                      maxLength={2}
                      placeholder="Prefix"
                      value={departmentCodeInput}
                      onChange={(event) => setDepartmentCodeInput(event.target.value.toUpperCase())}
                    />
                    <button type="button" className="primary-btn" onClick={handleAddOrUpdateDepartment}>
                      {departmentEditingName ? 'Update' : 'Add'}
                    </button>
                  </div>
                </label>
                {departmentError ? <p className="form-error">{departmentError}</p> : null}
                <div>
                  <span className="field-title">Departments & Prefixes</span>
                  <div className="department-list">
                    {appSettings.departments.map((department) => (
                      <div key={department.name} className="department-row">
                        <span>{department.name}</span>
                        <span className="department-code">{department.code}</span>
                        <button
                          type="button"
                          className="mini-btn"
                          onClick={() => handleEditDepartment(department)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="mini-btn danger"
                          onClick={() => handleDeleteDepartment(department.name)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="settings-divider" />
                <label>
                  <span>{employmentStageEditingValue ? 'Edit Employment Stage' : 'Add Employment Stage'}</span>
                  <div className="inline-field">
                    <input
                      placeholder="Employment stage"
                      value={employmentStageInput}
                      onChange={(event) => setEmploymentStageInput(event.target.value)}
                    />
                    <button type="button" className="primary-btn" onClick={handleAddOrUpdateEmploymentStage}>
                      {employmentStageEditingValue ? 'Update' : 'Add'}
                    </button>
                  </div>
                </label>
                {employmentStageError ? <p className="form-error">{employmentStageError}</p> : null}
                <div>
                  <span className="field-title">Employment Stages</span>
                  <div className="department-list">
                    {appSettings.employmentStages.map((stage) => (
                      <div key={stage} className="employment-stage-row">
                        <span>{stage}</span>
                        <button
                          type="button"
                          className="mini-btn"
                          onClick={() => handleEditEmploymentStage(stage)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="mini-btn danger"
                          onClick={() => handleDeleteEmploymentStage(stage)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="settings-divider" />
                <label>
                  <span>ID Card Company Name</span>
                  <input
                    value={appSettings.idCardDesign.companyName}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        idCardDesign: {
                          ...prev.idCardDesign,
                          companyName: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>ID Card Logo</span>
                  <input type="file" accept="image/*" onChange={handleIdCardLogoUpload} />
                </label>
                {appSettings.idCardDesign.logoUrl ? (
                  <div className="id-logo-preview-wrap">
                    <img src={appSettings.idCardDesign.logoUrl} alt="Company logo" className="id-logo-preview" />
                    <button
                      type="button"
                      className="mini-btn danger"
                      onClick={() =>
                        setAppSettings((prev) => ({
                          ...prev,
                          idCardDesign: {
                            ...prev.idCardDesign,
                            logoUrl: '',
                          },
                        }))
                      }
                    >
                      Remove logo
                    </button>
                  </div>
                ) : null}
                <label>
                  <span>ID Card Primary Color</span>
                  <input
                    type="color"
                    value={appSettings.idCardDesign.primaryColor}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        idCardDesign: {
                          ...prev.idCardDesign,
                          primaryColor: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>ID Card Secondary Color</span>
                  <input
                    type="color"
                    value={appSettings.idCardDesign.secondaryColor}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        idCardDesign: {
                          ...prev.idCardDesign,
                          secondaryColor: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>ID Card Orientation</span>
                  <select
                    className="filter-select"
                    value={appSettings.idCardDesign.orientation}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        idCardDesign: {
                          ...prev.idCardDesign,
                          orientation: event.target.value === 'portrait' ? 'portrait' : 'landscape',
                        },
                      }))
                    }
                  >
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                  </select>
                </label>
                <label>
                  <span>ID Card Border Radius ({appSettings.idCardDesign.borderRadius}px)</span>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={appSettings.idCardDesign.borderRadius}
                    onChange={(event) =>
                      setAppSettings((prev) => ({
                        ...prev,
                        idCardDesign: {
                          ...prev.idCardDesign,
                          borderRadius: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
              </div>
            </section>
          ) : (
            <section className="panel table-panel">
              <div className="panel-title-row">
                <div>
                  <h2>{activeModuleConfig.title}</h2>
                  <p>{activeModuleConfig.entityLabel} registry and operations table</p>
                </div>
                <button type="button" className="primary-btn" onClick={startCreate}>
                  + Add {activeModuleConfig.entityLabel}
                </button>
              </div>

              <div className="toolbar">
                <input
                  className="search-input"
                  placeholder="Search records..."
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                />
                <select
                  className="filter-select"
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                >
                  {filterOptions.map((option) => (
                    <option key={option} value={option}>
                      {activeModuleConfig.filterLabel}: {option}
                    </option>
                  ))}
                </select>
                {isEmployeeModule ? (
                  <select
                    className="filter-select"
                    value={statusFilterValue}
                    onChange={(event) => setStatusFilterValue(event.target.value)}
                  >
                    {employeeStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        Status: {option}
                      </option>
                    ))}
                  </select>
                ) : null}
                {isEmployeeModule ? (
                  <select
                    className="filter-select"
                    value={employmentStageFilterValue}
                    onChange={(event) => setEmploymentStageFilterValue(event.target.value)}
                  >
                    {employeeStageOptions.map((option) => (
                      <option key={option} value={option}>
                        Employment Stage: {option}
                      </option>
                    ))}
                  </select>
                ) : null}
                {isEmployeeModule ? (
                  <select
                    className="filter-select"
                    value={expiryFilterValue}
                    onChange={(event) => setExpiryFilterValue(event.target.value)}
                  >
                    <option value="All">Expiry: All</option>
                    <option value="within30">Expiry: 0-30 days</option>
                    <option value="after30">Expiry: Above 30 days</option>
                    <option value="expired">Expiry: Already expired</option>
                    <option value="no-end-date">Expiry: No end date</option>
                  </select>
                ) : null}
                {isEmployeeModule ? (
                  <select
                    className="filter-select"
                    value={sortByValue}
                    onChange={(event) => setSortByValue(event.target.value)}
                  >
                    <option value="default">Sort: Default</option>
                    <option value="expiry-priority">Sort: Expiry priority</option>
                    <option value="closest-expiry">Sort: Closest expiry date</option>
                  </select>
                ) : null}
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() => {
                    setSearchText('');
                    setFilterValue('All');
                    setStatusFilterValue('All');
                    setEmploymentStageFilterValue('All');
                    setExpiryFilterValue('All');
                    setSortByValue('default');
                  }}
                >
                  Reset
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {tableColumns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length > 0 ? (
                      filteredRows.map((row) => (
                        <tr
                          key={row.id}
                          className={selectedRowId === row.id ? 'selected-row' : ''}
                          onClick={() => openDetails(row.id)}
                        >
                          {tableColumns.map((column) => (
                            <td key={column.key}>
                              {column.key === 'contractAlert' ? (
                                <span className={`contract-alert ${getContractCountdown(row.contractEndDate)?.type || ''}`}>
                                  {getContractCountdown(row.contractEndDate)?.shortLabel || '—'}
                                </span>
                              ) : (
                                row[column.key]
                              )}
                            </td>
                          ))}
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="mini-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openDetails(row.id);
                                }}
                              >
                                View
                              </button>
                              <button
                                type="button"
                                className="mini-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startEdit(row);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="mini-btn danger"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDelete(row.id);
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={tableColumns.length + 1}>
                          <p className="empty-state">No matching records found.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>
      {!isSettingsPage && isModalOpen ? (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {isFormModal
                  ? editRowId === 'new'
                    ? `Add ${activeModuleConfig.entityLabel}`
                    : `Edit ${activeModuleConfig.entityLabel}`
                  : `${activeModuleConfig.entityLabel} Details`}
              </h3>
              <button type="button" className="neutral-btn" onClick={closeModal}>
                Close
              </button>
            </div>
            {isFormModal ? (
              <div className="form-grid">
                {visibleFormFields.map((field) => (
                  <label key={field.key}>
                    <span>
                      {getFieldLabel(field)}
                      {field.required ? ' *' : ''}
                    </span>
                    {field.type === 'select' ? (
                      <select
                        className="filter-select"
                        value={formValues[field.key] || ''}
                        onChange={(event) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [field.key]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select {getFieldLabel(field)}</option>
                        {(
                          field.key === 'department' && activeModuleId === 'employee-management'
                            ? currentDepartmentOptions
                            : field.key === 'employmentState' && activeModuleId === 'employee-management'
                              ? currentEmploymentStageOptions
                              : field.options || []
                        ).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        className="form-textarea"
                        value={formValues[field.key] || ''}
                        onChange={(event) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [field.key]: event.target.value,
                          }))
                        }
                      />
                    ) : field.type === 'file' ? (
                      <>
                        <input
                          type="file"
                          multiple={field.multiple}
                          onChange={(event) => {
                            const selectedFiles = Array.from(event.target.files || []);
                            const selectedFilesMeta = selectedFiles.map((file) => ({
                              name: file.name,
                              url: URL.createObjectURL(file),
                              isImage: file.type.startsWith('image/'),
                              note: '',
                            }));
                            setFormValues((prev) => {
                              const previousFiles = Array.isArray(prev[`${field.key}Files`])
                                ? prev[`${field.key}Files`]
                                : [];
                              const mergedFiles = field.multiple
                                ? [...previousFiles, ...selectedFilesMeta]
                                : selectedFilesMeta;
                              const mergedImagePreviews = mergedFiles
                                .filter((file) => file.isImage)
                                .map((file) => file.url);
                              return {
                                ...prev,
                                [field.key]: mergedFiles.map((file) => file.name).join(', '),
                                [`${field.key}Preview`]: field.multiple
                                  ? mergedImagePreviews
                                  : mergedImagePreviews[0] || '',
                                [`${field.key}Files`]: mergedFiles,
                              };
                            });
                          }}
                        />
                        {formValues[field.key] ? <span className="file-name">{formValues[field.key]}</span> : null}
                        {Array.isArray(formValues[`${field.key}Files`]) &&
                        formValues[`${field.key}Files`].length > 0 ? (
                          <div className="file-link-list">
                            {formValues[`${field.key}Files`].map((fileItem, index) => (
                              <div className="file-entry-card" key={`${field.key}-${fileItem.name}-${index}`}>
                                <div className="file-link-row">
                                  <a
                                    className="file-link"
                                    href={fileItem.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {fileItem.name}
                                  </a>
                                  <div className="file-inline-actions">
                                    <a className="file-download" href={fileItem.url} download={fileItem.name}>
                                      Download
                                    </a>
                                    <button
                                      type="button"
                                      className="file-remove-btn"
                                      onClick={() =>
                                        setFormValues((prev) => {
                                          const previousFiles = Array.isArray(prev[`${field.key}Files`])
                                            ? prev[`${field.key}Files`]
                                            : [];
                                          const updatedFiles = previousFiles.filter((_, itemIndex) => itemIndex !== index);
                                          const updatedPreviews = updatedFiles
                                            .filter((file) => file.isImage)
                                            .map((file) => file.url);
                                          return {
                                            ...prev,
                                            [field.key]: updatedFiles.map((file) => file.name).join(', '),
                                            [`${field.key}Preview`]: field.multiple
                                              ? updatedPreviews
                                              : updatedPreviews[0] || '',
                                            [`${field.key}Files`]: updatedFiles,
                                          };
                                        })
                                      }
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                                <input
                                  className="file-note-input"
                                  placeholder="Document note (e.g. School Certificate, Contract)"
                                  value={fileItem.note || ''}
                                  onChange={(event) =>
                                    setFormValues((prev) => {
                                      const previousFiles = Array.isArray(prev[`${field.key}Files`])
                                        ? prev[`${field.key}Files`]
                                        : [];
                                      const updatedFiles = previousFiles.map((item, itemIndex) =>
                                        itemIndex === index ? { ...item, note: event.target.value } : item
                                      );
                                      return {
                                        ...prev,
                                        [`${field.key}Files`]: updatedFiles,
                                      };
                                    })
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {!field.multiple && formValues[`${field.key}Preview`] ? (
                          <img
                            src={formValues[`${field.key}Preview`]}
                              alt={`${getFieldLabel(field)} preview`}
                            className="upload-preview"
                          />
                        ) : null}
                      </>
                    ) : (
                      <input
                        type={field.type || 'text'}
                        value={formValues[field.key] || ''}
                        onChange={(event) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [field.key]: event.target.value,
                          }))
                        }
                      />
                    )}
                  </label>
                ))}
                {formError ? <p className="form-error">{formError}</p> : null}
                <div className="form-actions">
                  <button type="button" className="primary-btn" onClick={handleSave}>
                    Save
                  </button>
                  <button type="button" className="neutral-btn" onClick={closeModal}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="details-card">
                {modalRow ? (
                  <>
                    <div className="details-hero">
                      <div>
                        <p className="details-kicker">{activeModuleConfig.entityLabel} Profile</p>
                        <h4>{modalRow.fullName || modalRow.name || modalRow.id}</h4>
                        <p className="details-subtitle">
                          {modalRow.department || 'Department'} • {modalRow.position || 'Role not set'}
                        </p>
                      </div>
                      <div className="details-badges">
                        {modalRow.status ? <span className="status-badge">{modalRow.status}</span> : null}
                        {modalRow.employmentState ? (
                          <span className="status-badge secondary">{modalRow.employmentState}</span>
                        ) : null}
                        {modalContractCountdown ? (
                          <span className={`status-badge contract ${modalContractCountdown.type}`}>
                            {modalContractCountdown.detailLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {activeModuleId === 'employee-management' ? (
                      <div className="details-media-grid">
                        {employeeImageFields.map((key) => {
                          const imageFiles = Array.isArray(modalRow[`${key}Files`]) ? modalRow[`${key}Files`] : [];
                          const imageFile = imageFiles.find((file) => file.isImage);
                          const imageSource = imageFile?.url || modalRow[`${key}Preview`] || '';
                          return (
                            <div className="media-card" key={key}>
                              <span className="media-label">
                                {activeModuleConfig.formFields.find((field) => field.key === key)?.label || key}
                              </span>
                              {imageSource ? (
                                <img src={imageSource} alt={key} className="media-image" />
                              ) : (
                                <strong>{modalRow[key] || 'No file uploaded'}</strong>
                              )}
                              {imageFile?.url ? (
                                <div className="media-actions">
                                  <a href={imageFile.url} target="_blank" rel="noreferrer">
                                    Preview
                                  </a>
                                  <a href={imageFile.url} download={imageFile.name}>
                                    Download
                                  </a>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="details-grid-table">
                      <div className="detail-cell">
                        <span>{activeModuleConfig.entityLabel} ID</span>
                        <strong>{modalRow.id}</strong>
                      </div>
                      {activeModuleConfig.formFields
                        .filter((field) => !employeeImageFields.includes(field.key))
                        .map((field) => (
                          <div className="detail-cell" key={field.key}>
                            <span>{getFieldLabel(field)}</span>
                            {field.type === 'file' &&
                            Array.isArray(modalRow[`${field.key}Files`]) &&
                            modalRow[`${field.key}Files`].length > 0 ? (
                              <div className="file-link-list details-file-list">
                                {modalRow[`${field.key}Files`].map((fileItem, index) => (
                                  <div className="file-entry-card" key={`${field.key}-details-${fileItem.name}-${index}`}>
                                    <div className="file-link-row details-file-row">
                                      <a className="file-link details-file-link" href={fileItem.url} target="_blank" rel="noreferrer">
                                        {fileItem.name}
                                      </a>
                                      <a className="file-download" href={fileItem.url} download={fileItem.name}>
                                        Download
                                      </a>
                                    </div>
                                    {fileItem.note ? <span className="file-note-text">{fileItem.note}</span> : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <strong>{field.key === 'password' ? '••••••••' : modalRow[field.key] || '—'}</strong>
                            )}
                          </div>
                        ))}
                    </div>
                    {activeModuleId === 'employee-management' ? (
                      <div className="employee-ops-card">
                        <div className="employee-ops-header">
                          <h5>Employee Leave Operations</h5>
                          <span>{employeeLeaveRequests.length} requests</span>
                        </div>
                        <div className="employee-ops-form">
                          <select
                            className="filter-select"
                            value={leaveDraft.type}
                            onChange={(event) => handleEmployeeLeaveDraftChange('type', event.target.value)}
                          >
                            <option value="Annual">Annual</option>
                            <option value="Sick">Sick</option>
                            <option value="Maternity">Maternity</option>
                            <option value="Paternity">Paternity</option>
                            <option value="Compassionate">Compassionate</option>
                            <option value="Unpaid">Unpaid</option>
                          </select>
                          <input
                            type="date"
                            value={leaveDraft.startDate}
                            onChange={(event) => handleEmployeeLeaveDraftChange('startDate', event.target.value)}
                          />
                          <input
                            type="date"
                            value={leaveDraft.endDate}
                            onChange={(event) => handleEmployeeLeaveDraftChange('endDate', event.target.value)}
                          />
                          <button type="button" className="primary-btn" onClick={handleSubmitEmployeeLeaveRequest}>
                            Submit Leave Request
                          </button>
                        </div>
                        <div className="employee-ops-list">
                          {employeeLeaveRequests.length > 0 ? (
                            employeeLeaveRequests.slice(0, 6).map((leaveRow) => (
                              <div className="employee-ops-row" key={leaveRow.id}>
                                <div>
                                  <p>{leaveRow.type}</p>
                                  <span>
                                    {leaveRow.startDate} → {leaveRow.endDate}
                                  </span>
                                </div>
                                <div className="employee-ops-actions">
                                  <strong>{leaveRow.status || 'Pending'}</strong>
                                  {leaveRow.status === 'Pending' || leaveRow.status === 'Planned' ? (
                                    <>
                                      <button
                                        type="button"
                                        className="mini-btn"
                                        onClick={() => handleUpdateLeaveStatus(leaveRow.id, 'Approved')}
                                      >
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        className="mini-btn danger"
                                        onClick={() => handleUpdateLeaveStatus(leaveRow.id, 'Rejected')}
                                      >
                                        Reject
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="employee-ops-empty">No leave request exists for this employee yet.</p>
                          )}
                        </div>
                      </div>
                    ) : null}
                    {activeModuleId === 'employee-management' ? (
                      <div className={`id-preview-grid ${appSettings.idCardDesign.orientation}`}>
                        <div
                          className={`id-preview-card ${appSettings.idCardDesign.orientation}`}
                          style={{
                            '--id-radius': `${appSettings.idCardDesign.borderRadius}px`,
                            '--id-primary': appSettings.idCardDesign.primaryColor,
                            '--id-secondary': appSettings.idCardDesign.secondaryColor,
                          }}
                        >
                          <div className="id-preview-head">
                            <div className="id-preview-head-text">
                              <strong className="id-preview-title">EMPLOYEE ID CARD</strong>
                              <span>{appSettings.idCardDesign.companyName || appSettings.appName || 'PTHR'}</span>
                            </div>
                            {appSettings.idCardDesign.logoUrl ? (
                              <img src={appSettings.idCardDesign.logoUrl} alt="logo" className="id-preview-logo" />
                            ) : null}
                          </div>
                          <div className="id-preview-subhead">{modalRow.department || 'Department'}</div>
                          <div className={`id-preview-body ${appSettings.idCardDesign.orientation}`}>
                            <div className="id-preview-photo">
                              {modalPassportPhotoUrl ? (
                                <img src={modalPassportPhotoUrl} alt="passport" className="id-preview-photo-img" />
                              ) : (
                                <span>PHOTO</span>
                              )}
                            </div>
                            <div className="id-preview-info">
                              <p>
                                <span>Name</span>
                                <strong>{modalRow.fullName || '—'}</strong>
                              </p>
                              <p>
                                <span>Position</span>
                                <strong>{modalRow.position || '—'}</strong>
                              </p>
                              <p>
                                <span>Employee Number</span>
                                <strong>{modalRow.id || '—'}</strong>
                              </p>
                              <p>
                                <span>Date of Expiry</span>
                                <strong>{formatCardDate(modalRow.contractEndDate)}</strong>
                              </p>
                            </div>
                          </div>
                          <div className="id-preview-footer">
                            {modalBarcodeDataUrl ? (
                              <img src={modalBarcodeDataUrl} alt="Employee barcode" className="id-preview-barcode-img" />
                            ) : (
                              <div className="id-preview-barcode" />
                            )}
                          </div>
                        </div>
                        <div
                          className={`id-preview-card ${appSettings.idCardDesign.orientation}`}
                          style={{
                            '--id-radius': `${appSettings.idCardDesign.borderRadius}px`,
                            '--id-primary': appSettings.idCardDesign.primaryColor,
                            '--id-secondary': appSettings.idCardDesign.secondaryColor,
                          }}
                        >
                          <div className="id-preview-head">
                            <div className="id-preview-head-text">
                              <strong className="id-preview-title">OFFICIAL BACK</strong>
                              <span>{appSettings.idCardDesign.companyName || appSettings.appName || 'PTHR'}</span>
                            </div>
                            {appSettings.idCardDesign.logoUrl ? (
                              <img src={appSettings.idCardDesign.logoUrl} alt="logo" className="id-preview-logo" />
                            ) : null}
                          </div>
                          <div className={`id-preview-back-body ${appSettings.idCardDesign.orientation}`}>
                            <p>
                              <span>ID</span>
                              <strong>{modalRow.id || '—'}</strong>
                            </p>
                            <p>
                              <span>Name</span>
                              <strong>{modalRow.fullName || '—'}</strong>
                            </p>
                            <p>
                              <span>Department</span>
                              <strong>{modalRow.department || '—'}</strong>
                            </p>
                            <p>
                              <span>Emergency Contact</span>
                              <strong>
                                {modalRow.emergencyContact1Name || 'N/A'} • {modalRow.emergencyContact1Phone || 'N/A'}
                              </strong>
                            </p>
                            <p>
                              <span>Expiry</span>
                              <strong>{formatCardDate(modalRow.contractEndDate)}</strong>
                            </p>
                            {appSettings.idCardDesign.logoUrl ? (
                              <div className="id-preview-back-logo-wrap">
                                <img src={appSettings.idCardDesign.logoUrl} alt="logo" className="id-preview-back-logo" />
                              </div>
                            ) : null}
                            <div className="id-preview-back-footer">
                              <div className="id-preview-qr" />
                              <div className="id-preview-signatures">
                                <span>Employee Signature</span>
                                <span>HR Manager</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="form-actions">
                      <button type="button" className="primary-btn" onClick={() => startEdit(modalRow)}>
                        Edit
                      </button>
                      {activeModuleId === 'employee-management' ? (
                        <>
                          <button
                            type="button"
                            className="neutral-btn id-download-btn"
                            onClick={() => handleDownloadEmployeeId(modalRow, 'front')}
                          >
                            Download Front ID
                          </button>
                          <button
                            type="button"
                            className="neutral-btn id-download-btn"
                            onClick={() => handleDownloadEmployeeId(modalRow, 'back')}
                          >
                            Download Back ID
                          </button>
                          <button
                            type="button"
                            className="neutral-btn id-download-btn"
                            onClick={() => handleDownloadBothEmployeeIdSides(modalRow)}
                          >
                            Download Both Sides
                          </button>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="empty-state">No row selected yet. Pick any row from the table.</p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
