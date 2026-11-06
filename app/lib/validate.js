// Input validation. Every rule here is enforced again by a database CHECK
// constraint, so a bug in this file cannot put invalid data on disk.

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function normalizeText(value) {
  return String(value ?? '').trim();
}

export function validateRegistration({ username, email, password, confirmPassword, acceptTerms }) {
  const errors = {};

  // Usernames are stored lowercase (enforced by a database CHECK) so two
  // accounts cannot differ only by case and impersonate each other.
  const name = normalizeText(username).toLowerCase();
  if (!name) errors.username = 'Choose a username.';
  else if (!USERNAME.test(name)) {
    errors.username = '3-32 characters: letters, digits, dot, dash, underscore. Stored lowercase.';
  }

  const mail = normalizeText(email).toLowerCase();
  if (!mail) errors.email = 'Enter an email address.';
  else if (mail.length > 254 || !EMAIL.test(mail)) errors.email = 'That email address does not look valid.';

  const pass = String(password ?? '');
  if (pass.length < 12) errors.password = 'Use at least 12 characters.';
  else if (pass.length > 200) errors.password = 'That password is too long.';
  else if (!/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) {
    errors.password = 'Mix letters and numbers.';
  }

  if (pass !== String(confirmPassword ?? '')) errors.confirmPassword = 'Passwords do not match.';

  if (!acceptTerms) errors.acceptTerms = 'You must accept the archive rules.';

  return { errors, value: { username: name, email: mail, password: pass } };
}

export function validateLogin({ email, password }) {
  const errors = {};
  const mail = normalizeText(email).toLowerCase();
  if (!mail) errors.email = 'Enter your email address.';
  if (!String(password ?? '')) errors.password = 'Enter your password.';
  return { errors, value: { email: mail, password: String(password ?? '') } };
}

// Shape check for a new password chosen during a reset. Same rules as
// registration so an account cannot end up with a weaker password than it
// started with.
export function validatePasswordChange({ password, confirmPassword }) {
  const errors = {};
  const pass = String(password ?? '');
  if (pass.length < 12) errors.password = 'Use at least 12 characters.';
  else if (pass.length > 200) errors.password = 'That password is too long.';
  else if (!/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) {
    errors.password = 'Mix letters and numbers.';
  }
  if (pass !== String(confirmPassword ?? '')) errors.confirmPassword = 'Passwords do not match.';
  return { errors, value: { password: pass } };
}

export function isSolanaAddress(value) {
  return BASE58.test(String(value ?? ''));
}

export function validateWalletLink({ address, signature, nonce }) {
  const errors = {};
  if (!isSolanaAddress(address)) errors.address = 'That is not a Solana address.';
  if (!String(signature ?? '').trim()) errors.signature = 'Wallet signature is missing.';
  if (!/^[a-f0-9]{32}$/.test(String(nonce ?? ''))) errors.nonce = 'Verification challenge is invalid.';
  return { errors, value: { address: normalizeText(address), signature: normalizeText(signature), nonce: normalizeText(nonce) } };
}

// Fixed message catalogue: user-facing copy is looked up by key, never taken
// from the query string, so nothing a visitor types is ever reflected back.
export const MESSAGES = {
  'verify-sent': 'ACCOUNT CREATED. CHECK YOUR EMAIL FOR THE VERIFICATION LINK.',
  'verify-required': 'VERIFY YOUR EMAIL BEFORE SIGNING IN.',
  'verify-failed': 'THAT VERIFICATION LINK IS INVALID OR EXPIRED.',
  'verified': 'EMAIL VERIFIED. YOU MAY SIGN IN.',
  'password-reset-sent': 'IF AN ACCOUNT EXISTS FOR THAT EMAIL, A RESET LINK WAS ISSUED. OPEN IT WITHIN 1 HOUR.',
  'password-reset-done': 'PASSWORD UPDATED. SIGN IN WITH THE NEW ONE.',
  'password-reset-expired': 'THAT RESET LINK IS INVALID OR EXPIRED. REQUEST A NEW ONE.',
  'password-reset-mismatch': 'THE PASSWORDS DO NOT MATCH.',
  'invalid-credentials': 'INVALID EMAIL OR PASSWORD.',
  'signed-out': 'SESSION CLOSED.',
  'login-required': 'ACCOUNT REQUIRED. SIGN IN TO CONTINUE.',
  'wallet-linked': 'WALLET LINKED AND VERIFIED ON-CHAIN.',
  'wallet-exists': 'THAT WALLET IS ALREADY LINKED TO AN ACCOUNT.',
  'wallet-failed': 'WALLET VERIFICATION FAILED. TRY AGAIN.',
  'wallet-expired': 'VERIFICATION CHALLENGE EXPIRED. REQUEST A NEW ONE.',
  'wallet-none': 'NO WALLET LINKED.',
  'password-mismatch': 'PASSWORDS DO NOT MATCH.',
  'form-invalid': 'CHECK THE HIGHLIGHTED FIELDS.',
  'username-taken': 'THAT USERNAME IS TAKEN.',
  'email-taken': 'THAT EMAIL IS ALREADY REGISTERED.',
  'rate-limited': 'TOO MANY ATTEMPTS. WAIT AND TRY AGAIN.',
  'file-created': 'FILE CREATED AS A DRAFT. PUBLISH IT WHEN THE BRIEFING IS READY.',
  'file-saved': 'FILE UPDATED.',
  'file-unknown': 'NO SUCH FILE.',
  'answer-saved': 'CHALLENGE ANSWER SEALED. THE PLAINTEXT IS NOT STORED ANYWHERE.',
  'answer-locked': 'THE ANSWER CANNOT CHANGE: SOMEONE HAS ALREADY SUBMITTED AGAINST IT.',
  'attachment-saved': 'ATTACHMENT STORED PRIVATELY.',
  'attachment-removed': 'ATTACHMENT REMOVED.',
  'admin-required': 'ARCHIVIST SIGN-IN REQUIRED.',
  // Mystery layer
  'file-unlocked': 'ACCESS CODE ACCEPTED. THE SEALED SECTION IS NOW VISIBLE.',
  'code-invalid': 'ACCESS CODE REFUSED. CHECK THE RECOVERED FRAGMENT.',
  'file-sealed': 'THIS FILE IS SEALED. FIND THE CODE OR THE PRECEDING RECORD FIRST.',
  'prerequisite-missing': 'THE PREVIOUS FILE HAS NOT BEEN RECOVERED.',
  'clue-required': 'A RECOVERED CLUE IS REQUIRED BEFORE THIS FILE OPENS.',
  'clue-found': 'SIGNAL LOGGED. A NEW FRAGMENT IS IN YOUR INVESTIGATION LOG.',
  'clue-locked': 'SIGNAL LOCKED. DECODE THE EARLIER FRAGMENT FIRST.',
  'clue-unknown': 'NO SUCH SIGNAL EXISTS IN THIS ARCHIVE.',
  'clue-disabled': 'THIS SIGNAL HAS GONE DARK.',
  'answer-correct': 'ANSWER ACCEPTED. THE SUBMISSION IS QUEUED FOR ARCHIVIST REVIEW.',
  'answer-incorrect': 'ANSWER REFUSED. THE ATTEMPT WAS RECORDED.',
  'answer-required': 'ENTER AN ANSWER.',
  'attempts-exhausted': 'NO ATTEMPTS REMAIN FOR THIS FILE.',
  'already-submitted': 'A CORRECT SUBMISSION IS ALREADY ON FILE. WAIT FOR REVIEW.',
  'submission-holding': 'HOLDING REQUIREMENT NOT MET AT SUBMISSION TIME.',
  'wallet-required': 'LINK A WALLET BEFORE SUBMITTING.',
  'chapter-locked': 'THIS CHAPTER IS ENCRYPTED. RECOVER MORE FRAGMENTS.',
  'chapter-unknown': 'NO SUCH CHAPTER.',
  'chapter-saved': 'CHAPTER SAVED.',
  'chapter-created': 'CHAPTER CREATED AS A DRAFT.',
  'clue-saved': 'CLUE SAVED.',
  'clue-created': 'CLUE CREATED. IT IS HIDDEN UNTIL SOMEONE FINDS IT.',
  'clue-deleted': 'CLUE REMOVED.',
  'submission-approved': 'SUBMISSION APPROVED. A REWARD RECORD IS AWAITING MANUAL PAYMENT.',
  'submission-rejected': 'SUBMISSION REJECTED.',
  'submission-unknown': 'NO SUCH SUBMISSION.',
  'reward-unknown': 'NO SUCH REWARD.',
  'reward-confirmed': 'TRANSACTION VERIFIED AND REWARD CONFIRMED.',
  'reward-pending': 'TRANSACTION NOT YET CONFIRMED ON-CHAIN. THE REWARD REMAINS OPEN.',
  'reward-failed': 'TRANSACTION VERIFICATION FAILED. THE REWARD REMAINS OPEN.',
  'reward-already-confirmed': 'THIS REWARD IS ALREADY CONFIRMED.',
  'transaction-duplicate': 'THAT SIGNATURE IS ALREADY RECORDED.',
  'transaction-invalid': 'THAT IS NOT A VALID SOLANA SIGNATURE.',
  'verifier-unavailable': 'ON-CHAIN VERIFICATION IS UNAVAILABLE. NOTHING WAS MARKED PAID.',
  'holding-failed': 'THE WALLET NO LONGER HOLDS THE REQUIRED F106. APPROVAL REFUSED.',
  'balance-unavailable': 'THE HOLDING COULD NOT BE READ. APPROVAL REFUSED.',
  'winner-limit': 'THIS FILE HAS REACHED ITS WINNER LIMIT.',
  'winner-duplicate': 'THIS WALLET HAS ALREADY WON THIS FILE.',
  'submission-not-pending': 'THAT SUBMISSION IS NOT AWAITING REVIEW.',
  'reward-recorded': 'REWARD RECORD CREATED.',
  // Per-file reward conditions
  'requirement-created': 'REWARD CONDITION ADDED. PARTICIPANTS SEE IT ON THE FILE.',
  'requirement-deleted': 'REWARD CONDITION REMOVED.',
  'requirement-unknown': 'NO SUCH REWARD CONDITION.',
  'requirement-invalid': 'CHECK THE REWARD CONDITION FIELDS.',
  'requirement-position-taken': 'THAT POSITION IS ALREADY USED BY ANOTHER CONDITION.',
  'proof-submitted': 'PROOF SUBMITTED. AN ARCHIVIST WILL REVIEW IT BEFORE THE CHECK TURNS GREEN.',
  'proof-required': 'ENTER THE HANDLE OR LINK THAT PROVES YOU COMPLETED THE TASK.',
  'proof-locked': 'THIS CONDITION IS ALREADY VERIFIED AND CANNOT BE CHANGED.',
  'verification-approved': 'CONDITION VERIFIED. THE PARTICIPANT NOW SEES A GREEN CHECK.',
  'verification-rejected': 'CONDITION REJECTED. THE PARTICIPANT SEES A RED CHECK AND MAY RESUBMIT.',
  'verification-unknown': 'NO SUCH PROOF RECORD.',
  'verification-not-pending': 'THAT PROOF IS NOT AWAITING REVIEW.',
  'requirements-incomplete': 'REWARD REFUSED: NOT EVERY REQUIRED CONDITION IS VERIFIED.',
  // Control room
  'file-deleted': 'FILE DELETED. THE AUDIT LOG KEEPS THE RECORD.',
  'file-delete-blocked': 'THIS FILE CANNOT BE DELETED: SUBMISSIONS OR REWARDS EXIST. ARCHIVE IT INSTEAD.',
  'file-duplicated': 'FILE DUPLICATED AS A NEW DRAFT.',
  'file-reordered': 'FILE ORDER UPDATED.',
  'puzzle-saved': 'PUZZLE SAVED. ANSWERS ARE SEALED AS HASHES.',
  'puzzle-deleted': 'PUZZLE REMOVED.',
  'puzzle-locked': 'THIS PUZZLE CANNOT CHANGE: SOMEONE HAS ALREADY SUBMITTED AGAINST IT.',
  'puzzle-unknown': 'NO SUCH PUZZLE ON THIS FILE.',
  'scheduled': 'FILE SCHEDULED. THE SCHEDULER OPENS IT AT THE SET TIME.',
  'window-closed': 'THIS FILE IS OUTSIDE ITS OPENING WINDOW.',
  'window-not-open': 'THIS FILE HAS NOT OPENED YET.',
  'puzzle-invalid': 'CHECK THE PUZZLE FIELDS.',
  'reviewer-read-only': 'REVIEWER ACCOUNTS HAVE READ-ONLY ACCESS.',
  'investigator-suspended': 'ACCOUNT SUSPENDED.',
  'investigator-activated': 'ACCOUNT REACTIVATED.',
  'investigator-unknown': 'NO SUCH INVESTIGATOR.',
  'investigator-banned': 'ACCOUNT BANNED.',
  'investigator-unbanned': 'ACCOUNT UNBANNED.',
  'investigator-deleted': 'ACCOUNT REMOVED.',
  'investigator-promoted': 'ARCHIVIST ACCOUNT CREATED. TEMPORARY PASSWORD SHOWN BELOW.',
  'investigator-password-reset': 'PASSWORD RESET. TEMPORARY PASSWORD SHOWN BELOW.',
  'investigator-already-archivist': 'THIS EMAIL IS ALREADY AN ARCHIVIST ACCOUNT.',
  'settings-saved': 'SETTINGS SAVED.',
  'team-created': 'ARCHIVIST ACCOUNT CREATED.',
  'team-updated': 'ARCHIVIST ACCOUNT UPDATED.',
  'team-blocked': 'THAT ACTION IS BLOCKED: THE LAST OWNER CANNOT BE REMOVED.',
  'team-owner-required': 'OWNER ROLE ONLY. YOU DO NOT HAVE IT.',
  'setup-done': 'OWNER ACCOUNT CREATED. SIGN IN TO OPEN THE CONTROL ROOM.',
  'setup-unavailable': 'SETUP IS CLOSED: AN ACTIVE OWNER ALREADY EXISTS.',
};

// ---------------------------------------------------------------------
// Admin input: files and challenges
// ---------------------------------------------------------------------

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'brutal'];
export const WINNER_METHODS = [
  'first_correct',
  'limited_winners',
  'multiple_correct',
  'admin_selected',
  'time_limited',
];

const SLUG = /^[a-z0-9-]{1,80}$/;

// FILE106 was minted at 106 units with the mint authority revoked, so 106 is not
// a budget that can be topped up — it is the entire supply, forever. A reward
// above it cannot be paid and a holding requirement above it cannot be met,
// which makes them impossible rather than merely large. Both are rejected here
// and by a check constraint, so no seed or script can reintroduce them.
export const TOTAL_SUPPLY_F106 = 106;

// F106 has 8 decimals; every amount is handed to Postgres as a numeric string so
// no float ever decides how much is owed.
function amount(raw, {
  fallback = null,
  allowZero = true,
  max = 1e12,
  maxMessage = 'That amount is implausibly large.',
} = {}) {
  const text = normalizeText(raw).replace(/,/g, '');
  if (text === '') return { value: fallback };
  if (!/^\d+(\.\d{1,8})?$/.test(text)) return { error: 'Use a plain number with up to 8 decimals.' };

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { error: 'Use a plain number with up to 8 decimals.' };
  if (parsed < 0 || (!allowZero && parsed === 0)) {
    return { error: allowZero ? 'Cannot be negative.' : 'Must be greater than zero.' };
  }
  if (parsed > max) return { error: maxMessage };

  return { value: parsed.toFixed(8) };
}

function timestamp(raw, label) {
  const text = normalizeText(raw);
  if (text === '') return { value: null };
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return { error: `${label} is not a valid date and time.` };
  return { value: parsed.toISOString() };
}

export function validateFileInput(body = {}) {
  const errors = {};

  const title = normalizeText(body.title);
  if (!title) errors.title = 'Give the file a title.';
  else if (title.length > 120) errors.title = 'Keep the title under 120 characters.';

  const teaser = normalizeText(body.teaser);
  if (!teaser) errors.teaser = 'Write the public teaser.';
  else if (teaser.length > 280) errors.teaser = 'Keep the teaser under 280 characters.';

  const briefing = normalizeText(body.briefing);
  if (briefing.length > 8000) errors.briefing = 'Keep the briefing under 8000 characters.';

  const numberRaw = normalizeText(body.fileNumber);
  const number = Number.parseInt(numberRaw, 10);
  if (!/^\d+$/.test(numberRaw) || !Number.isInteger(number) || number < 1 || number > 100000) {
    errors.fileNumber = 'Use a whole number between 1 and 100000.';
  }

  const slugInput = normalizeText(body.slug).toLowerCase();
  const slug = slugInput || (Number.isInteger(number) ? `file-${number}` : '');
  if (!SLUG.test(slug)) errors.slug = 'Lowercase letters, digits and dashes only.';

  const difficulty = normalizeText(body.difficulty) || 'medium';
  if (!DIFFICULTIES.includes(difficulty)) errors.difficulty = 'Unknown difficulty.';

  const winnerMethod = normalizeText(body.winnerMethod) || 'first_correct';
  if (!WINNER_METHODS.includes(winnerMethod)) errors.winnerMethod = 'Unknown winner method.';

  const reward = amount(body.reward, {
    fallback: null,
    allowZero: false,
    max: TOTAL_SUPPLY_F106,
    maxMessage: `The reward cannot exceed the total supply, ${TOTAL_SUPPLY_F106} F106.`,
  });
  if (reward.error) errors.reward = reward.error;
  else if (reward.value === null) errors.reward = 'Enter the reward amount in F106.';

  const holding = amount(body.minHolding, {
    fallback: '1.00000000',
    max: TOTAL_SUPPLY_F106,
    maxMessage: `The holding requirement cannot exceed the total supply, ${TOTAL_SUPPLY_F106} F106.`,
  });
  if (holding.error) errors.minHolding = holding.error;

  const maxWinnersRaw = normalizeText(body.maxWinners);
  let maxWinners = null;
  if (maxWinnersRaw !== '') {
    const parsed = Number.parseInt(maxWinnersRaw, 10);
    if (!/^\d+$/.test(maxWinnersRaw) || parsed < 1 || parsed > 1000) {
      errors.maxWinners = 'Use a whole number between 1 and 1000, or leave it blank.';
    } else {
      maxWinners = parsed;
    }
  }

  const opens = timestamp(body.opensAt, 'Opening time');
  if (opens.error) errors.opensAt = opens.error;
  const closes = timestamp(body.closesAt, 'Closing time');
  if (closes.error) errors.closesAt = closes.error;

  if (opens.value && closes.value && new Date(closes.value) <= new Date(opens.value)) {
    errors.closesAt = 'The closing time must be after the opening time.';
  }

  const subtitle = normalizeText(body.subtitle);
  if (subtitle.length > 200) errors.subtitle = 'Keep the subtitle under 200 characters.';

  const fileType = normalizeText(body.fileType) || 'story';
  if (!FILE_TYPES.includes(fileType)) errors.fileType = 'Unknown file type.';

  const sortRaw = normalizeText(body.sortOrder);
  let sortOrder = null;
  if (sortRaw !== '') {
    const parsed = Number.parseInt(sortRaw, 10);
    if (!/^\d+$/.test(sortRaw) || parsed < 0 || parsed > 100000) {
      errors.sortOrder = 'Use a whole number between 0 and 100000, or leave it blank.';
    } else {
      sortOrder = parsed;
    }
  }

  const classification = normalizeText(body.classification) || 'UNCLASSIFIED';
  if (classification.length > 40) errors.classification = 'Keep the classification under 40 characters.';

  const loreBody = normalizeText(body.loreBody);
  if (loreBody.length > 40000) errors.loreBody = 'Keep the recovered document under 40000 characters.';

  const chapterRaw = normalizeText(body.chapterNo);
  let chapterNo = null;
  if (chapterRaw !== '') {
    const parsed = Number.parseInt(chapterRaw, 10);
    if (!/^\d+$/.test(chapterRaw) || parsed < 1 || parsed > 99) {
      errors.chapterNo = 'Use a whole number between 1 and 99, or leave it blank.';
    } else {
      chapterNo = parsed;
    }
  }

  const mysteryOrderRaw = normalizeText(body.mysteryOrder);
  let mysteryOrder = null;
  if (mysteryOrderRaw !== '') {
    const parsed = Number.parseInt(mysteryOrderRaw, 10);
    if (!/^\d+$/.test(mysteryOrderRaw) || parsed < 1 || parsed > 999) {
      errors.mysteryOrder = 'Use a whole number between 1 and 999, or leave it blank.';
    } else {
      mysteryOrder = parsed;
    }
  }

  const unlockHint = normalizeText(body.unlockHint);
  if (unlockHint.length > 800) errors.unlockHint = 'Keep the hint under 800 characters.';

  const unlockCode = normalizeText(body.unlockCode);
  if (unlockCode !== '' && (unlockCode.length < 2 || unlockCode.length > 200)) {
    errors.unlockCode = 'Use between 2 and 200 characters, or leave it blank to keep the current code.';
  }

  const requiredFileRaw = normalizeText(body.requiredFileNumber);
  let requiredFileNumber = null;
  if (requiredFileRaw !== '') {
    const parsed = Number.parseInt(requiredFileRaw, 10);
    if (!/^\d+$/.test(requiredFileRaw) || parsed < 1 || parsed > 100000) {
      errors.requiredFileNumber = 'Use a whole file number, or leave it blank.';
    } else if (Number.isInteger(number) && parsed === number) {
      errors.requiredFileNumber = 'A file cannot require itself.';
    } else {
      requiredFileNumber = parsed;
    }
  }

  const clueRaw = normalizeText(body.unlockRequiresClue);
  let unlockRequiresClue = null;
  if (clueRaw !== '') {
    const parsed = Number.parseInt(clueRaw, 10);
    if (!/^\d+$/.test(clueRaw) || parsed < 1 || parsed > 999) {
      errors.unlockRequiresClue = 'Use a clue number such as 3, or leave it blank.';
    } else {
      unlockRequiresClue = parsed;
    }
  }

  const isMystery = Boolean(body.isMystery) || chapterNo !== null || loreBody !== '' || unlockCode !== '';

  const flag = (val, fallback = true) => {
    if (val === undefined) return body.formControlsPresent ? false : fallback;
    if (val === false || val === '0' || val === 'false' || val === 'off' || val === '') return false;
    return true;
  };

  return {
    errors,
    value: {
      fileNumber: number,
      slug,
      title,
      subtitle,
      fileType,
      sortOrder,
      requiresRegistration: flag(body.requiresRegistration, true),
      requiresWallet: flag(body.requiresWallet, true),
      rewardsEnabled: flag(body.rewardsEnabled, true),
      teaser,
      briefing,
      difficulty,
      winnerMethod,
      reward: reward.value,
      minHolding: holding.value,
      maxWinners,
      opensAt: opens.value,
      closesAt: closes.value,
      classification,
      loreBody,
      chapterNo,
      mysteryOrder,
      unlockHint,
      unlockCode,
      removeUnlockCode: Boolean(body.removeUnlockCode),
      requiredFileNumber,
      unlockRequiresClue,
      isMystery,
    },
  };
}

// 'scheduled' means: published, but invisible until the scheduler flips it to
// 'open' when opens_at arrives. The scheduler lives in app/index.js.
export const FILE_STATUSES = ['draft', 'scheduled', 'open', 'locked', 'closed', 'completed', 'archived'];

export const FILE_TYPES = [
  'story',
  'transmission',
  'puzzle',
  'image_evidence',
  'encrypted',
  'reward_challenge',
  'classified',
];

export const PUZZLE_TYPES = [
  'text',
  'numeric',
  'password',
  'choice',
  'code',
  'riddle',
  'sequence',
  'multi_step',
];

export function validateChallengeInput(body = {}) {
  const errors = {};

  const prompt = normalizeText(body.prompt);
  if (!prompt) errors.prompt = 'Write the prompt the participant answers.';
  else if (prompt.length > 4000) errors.prompt = 'Keep the prompt under 4000 characters.';

  const answerFormat = normalizeText(body.answerFormat) || 'text';
  if (!['text', 'numeric'].includes(answerFormat)) errors.answerFormat = 'Unknown answer format.';

  const puzzleType = normalizeText(body.puzzleType) || 'text';
  if (!PUZZLE_TYPES.includes(puzzleType)) errors.puzzleType = 'Unknown puzzle type.';

  const choices = [];
  if (puzzleType === 'choice') {
    const raw = String(body.choices ?? '')
      .split('\n')
      .map((line) => line.trim().slice(0, 200))
      .filter((line) => line !== '');
    if (raw.length < 2 || raw.length > 6) {
      errors.choices = 'A multiple-choice puzzle needs 2-6 options, one per line.';
    } else {
      choices.push(...raw);
    }
  }

  const answers = [normalizeText(body.answer), normalizeText(body.answer2), normalizeText(body.answer3)]
    .slice(0, puzzleType === 'choice' || puzzleType === 'multi_step' ? 3 : 3)
    .filter((entry, index) => entry !== '' || index === 0);
  const uniqueAnswers = [...new Set(answers.map((entry) => entry.toLowerCase()))];

  if (!answers[0]) {
    errors.answer = 'The answer is required: it is hashed, never stored.';
  }

  for (const [index, entry] of answers.entries()) {
    if (entry === '') continue;
    if (entry.length < 2) errors[`answer${index > 0 ? index + 1 : ''}`] = 'Use at least 2 characters.';
    else if (entry.length > 500) errors[`answer${index > 0 ? index + 1 : ''}`] = 'Keep the answer under 500 characters.';
    else if (answerFormat === 'numeric' && !/^-?\d+(\.\d+)?$/.test(entry)) {
      errors[`answer${index > 0 ? index + 1 : ''}`] = 'A numeric answer must contain only digits, a dash and a decimal point.';
    }
  }

  if (uniqueAnswers.length !== answers.length) {
    errors.answer2 = 'The accepted answers must differ.';
  }

  if (puzzleType === 'choice' && answers[0] && choices.length > 0) {
    const labelled = answers.every((entry) => entry === '' || choices.includes(entry));
    if (!labelled) errors.answer = 'A multiple-choice answer must be one of the listed options.';
  }

  const hint = normalizeText(body.hint);
  if (hint.length > 800) errors.hint = 'Keep the hint under 800 characters.';

  const maxAttempts = Number.parseInt(normalizeText(body.maxAttempts) || '1', 10);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    errors.maxAttempts = 'Allow between 1 and 10 attempts.';
  }

  const positionRaw = normalizeText(body.position);
  let position = 1;
  if (positionRaw !== '') {
    const parsed = Number.parseInt(positionRaw, 10);
    if (!/^\d+$/.test(positionRaw) || parsed < 1 || parsed > 6) {
      errors.position = 'A file supports up to 6 puzzles. Use a step number between 1 and 6.';
    } else {
      position = parsed;
    }
  }

  return {
    errors,
    value: {
      prompt,
      answer: answers[0] ?? '',
      answer2: answers[1] ?? '',
      answer3: answers[2] ?? '',
      answerFormat,
      puzzleType,
      choices,
      hint,
      caseSensitive: Boolean(body.caseSensitive),
      maxAttempts,
      position,
      hasAnswer2: Boolean(answers[1]),
      hasAnswer3: Boolean(answers[2]),
    },
  };
}

export function messageText(key) {
  return Object.prototype.hasOwnProperty.call(MESSAGES, key) ? MESSAGES[key] : '';
}

// ---------------------------------------------------------------------
// Mystery layer: chapters, clues, unlock codes, submissions, payouts
// ---------------------------------------------------------------------

export const CHAPTER_STATUSES = ['draft', 'published', 'archived'];

function optionalNumber(raw, { label, min = 1, max = 100000 }) {
  const text = normalizeText(raw);
  if (text === '') return { value: null };
  const parsed = Number.parseInt(text, 10);
  if (!/^\d+$/.test(text) || parsed < min || parsed > max) {
    return { error: `Use a whole number between ${min} and ${max}, or leave it blank.` };
  }
  return { value: parsed };
}

export function validateChapterInput(body = {}) {
  const errors = {};

  const chapterNoRaw = normalizeText(body.chapterNo);
  const chapterNo = Number.parseInt(chapterNoRaw, 10);
  if (!/^\d+$/.test(chapterNoRaw) || chapterNo < 1 || chapterNo > 99) {
    errors.chapterNo = 'Use a whole number between 1 and 99.';
  }

  const slugInput = normalizeText(body.slug).toLowerCase();
  const slug = slugInput || (Number.isInteger(chapterNo) ? `chapter-${chapterNo}` : '');
  if (!SLUG.test(slug)) errors.slug = 'Lowercase letters, digits and dashes only.';

  const eyebrow = normalizeText(body.eyebrow) || (Number.isInteger(chapterNo) ? `CHAPTER ${String(chapterNo).padStart(2, '0')}` : 'CHAPTER');
  if (eyebrow.length > 60) errors.eyebrow = 'Keep the eyebrow under 60 characters.';

  const title = normalizeText(body.title);
  if (!title) errors.title = 'Give the chapter a title.';
  else if (title.length > 120) errors.title = 'Keep the title under 120 characters.';

  const summary = normalizeText(body.summary);
  if (summary.length > 500) errors.summary = 'Keep the summary under 500 characters.';

  const chapterBody = normalizeText(body.body);
  if (!chapterBody) errors.body = 'Write the chapter text.';
  else if (chapterBody.length > 40000) errors.body = 'Keep the chapter under 40000 characters.';

  const requiredCluesRaw = normalizeText(body.requiredClueCount || '0');
  const requiredClueCount = Number.parseInt(requiredCluesRaw, 10);
  if (!/^\d+$/.test(requiredCluesRaw) || requiredClueCount < 0 || requiredClueCount > 99) {
    errors.requiredClueCount = 'Use a whole number between 0 and 99.';
  }

  const requiredFile = optionalNumber(body.requiredFileNumber, { label: 'Required file' });
  if (requiredFile.error) errors.requiredFileNumber = requiredFile.error;

  const status = normalizeText(body.status) || 'draft';
  if (!CHAPTER_STATUSES.includes(status)) errors.status = 'Unknown chapter status.';

  return {
    errors,
    value: {
      chapterNo,
      slug,
      eyebrow,
      title,
      summary,
      body: chapterBody,
      requiredClueCount,
      requiredFileNumber: requiredFile.value,
      status,
    },
  };
}

export function validateClueInput(body = {}) {
  const errors = {};

  const clueNoRaw = normalizeText(body.clueNo);
  const clueNo = Number.parseInt(clueNoRaw, 10);
  if (!/^\d+$/.test(clueNoRaw) || clueNo < 1 || clueNo > 999) {
    errors.clueNo = 'Use a whole number between 1 and 999.';
  }

  const slugInput = normalizeText(body.slug).toLowerCase();
  const slug = slugInput || (Number.isInteger(clueNo) ? `clue-${String(clueNo).padStart(3, '0')}` : '');
  if (!SLUG.test(slug)) errors.slug = 'Lowercase letters, digits and dashes only.';

  const title = normalizeText(body.title);
  if (!title) errors.title = 'Give the clue a title.';
  else if (title.length > 120) errors.title = 'Keep the title under 120 characters.';

  const clueBody = normalizeText(body.body);
  if (!clueBody) errors.body = 'Write what the clue reveals.';
  else if (clueBody.length > 12000) errors.body = 'Keep the clue under 12000 characters.';

  const hint = normalizeText(body.hint);
  if (hint.length > 800) errors.hint = 'Keep the hint under 800 characters.';

  const location = normalizeText(body.location);
  if (location.length > 200) errors.location = 'Keep the location under 200 characters.';

  const chapter = optionalNumber(body.chapterNo, { label: 'Chapter', max: 99 });
  if (chapter.error) errors.chapterNo = chapter.error;

  const file = optionalNumber(body.fileNumber, { label: 'File number', max: 100000 });
  if (file.error) errors.fileNumber = file.error;

  const requires = optionalNumber(body.requiresClueNo, { label: 'Required clue', max: 999 });
  if (requires.error) errors.requiresClueNo = requires.error;
  else if (requires.value !== null && requires.value === clueNo) {
    errors.requiresClueNo = 'A clue cannot require itself.';
  }

  const difficulty = normalizeText(body.difficulty) || 'medium';
  if (!DIFFICULTIES.includes(difficulty)) errors.difficulty = 'Unknown difficulty.';

  const released = timestamp(body.releaseAt, 'Release time');
  if (released.error) errors.releaseAt = released.error;

  return {
    errors,
    value: {
      clueNo,
      slug,
      title,
      body: clueBody,
      hint,
      location,
      chapterNo: chapter.value,
      fileNumber: file.value,
      requiresClueNo: requires.value,
      difficulty,
      releaseAt: released.value,
      isEnabled: body.isEnabled === undefined ? true : Boolean(body.isEnabled),
    },
  };
}

// Control-room settings: only whitelisted keys can be written, and each has its
// own shape check, so a mistyped form field cannot plant an arbitrary setting.
export const SETTING_KEYS = {
  'archive.default_min_holding': {
    parse: (raw) => amount(raw, { fallback: '1.00000000', max: TOTAL_SUPPLY_F106 }),
    label: 'Default minimum holding (F106)',
  },
  'archive.default_reward': {
    parse: (raw) => amount(raw, { fallback: '1.00000000', max: TOTAL_SUPPLY_F106 }),
    label: 'Default reward (F106)',
  },
  'archive.maintenance_banner': {
    parse: (raw) => ({ value: Boolean(raw) }),
    label: 'Maintenance banner on public pages',
  },
  'archive.tagline': {
    parse: (raw) => {
      const text = String(raw ?? '').trim();
      if (text.length > 200) return { error: 'Keep the tagline under 200 characters.' };
      return { value: text };
    },
    label: 'Archive tagline',
  },
};

export function validateSettingInput(key, raw) {
  const rule = SETTING_KEYS[key];
  if (!rule) return { error: 'Unknown setting.' };
  const parsed = rule.parse(raw);
  if (parsed.error) return { error: parsed.error };
  return { value: parsed.value };
}

export function validateUnlockCode(value) {
  const code = normalizeText(value);
  if (!code) return { error: 'Enter the recovered access code.' };
  if (code.length < 2 || code.length > 200) return { error: 'That code is not the right shape.' };
  return { value: code };
}

export function validateAnswerSubmission(value) {
  const answer = normalizeText(value);
  if (!answer) return { error: 'Enter an answer.' };
  if (answer.length > 500) return { error: 'Keep the answer under 500 characters.' };
  return { value: answer };
}

export const TRANSACTION_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export function validateTransactionSignature(value) {
  const signature = normalizeText(value);
  if (!TRANSACTION_SIGNATURE.test(signature)) {
    return { error: 'That is not a valid Solana transaction signature.' };
  }
  return { value: signature };
}

export function validateAdminNote(value) {
  const note = normalizeText(value);
  if (note.length > 2000) return { error: 'Keep the note under 2000 characters.' };
  return { value: note };
}

// ---------------------------------------------------------------------
// Per-file reward conditions
// ---------------------------------------------------------------------

export const REQUIREMENT_PLATFORMS = [
  'x',
  'telegram',
  'discord',
  'instagram',
  'tiktok',
  'youtube',
  'website',
  'other',
];

export const REQUIREMENT_KINDS = ['social_follow', 'visit_link', 'custom'];

// Short display names for generated titles.
const PLATFORM_LABELS = {
  x: 'X',
  telegram: 'Telegram',
  discord: 'Discord',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

const SOCIAL_PLATFORMS = ['x', 'telegram', 'discord', 'instagram', 'tiktok', 'youtube'];

const PLATFORM_DOMAINS = [
  [/^(www\.)?(x|twitter)\.com$/i, 'x'],
  [/^(www\.)?(t|telegram)\.me$/i, 'telegram'],
  [/^(www\.)?discord\.(gg|com)$/i, 'discord'],
  [/^(www\.)?instagram\.com$/i, 'instagram'],
  [/^(www\.)?tiktok\.com$/i, 'tiktok'],
  [/^(www\.)?(youtube\.com|youtu\.be)$/i, 'youtube'],
];

// The partner link is the one required input. Everything else the old form
// asked for is derived from it here, on the server, so the archivist pastes a
// URL and presses one button.
export function detectRequirementPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [pattern, platform] of PLATFORM_DOMAINS) {
      if (pattern.test(host)) return platform;
    }
  } catch {
    // Not a parseable URL: the caller reports that separately.
  }
  return null;
}

function deriveHandle(url, platform) {
  // Only platforms whose URL path is the handle. Discord invites and plain
  // websites are not handles, and YouTube only counts @handles.
  if (!['x', 'telegram', 'instagram', 'tiktok', 'youtube'].includes(platform)) return '';
  try {
    const segment = new URL(url).pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    if (!segment || segment.length > 100) return '';
    if (platform === 'youtube') return segment.startsWith('@') ? segment : '';
    return segment.startsWith('@') ? segment : `@${segment}`;
  } catch {
    return '';
  }
}

function autoTitle({ platform, kind, handle, url }) {
  if (kind === 'social_follow') {
    const verb = platform === 'telegram' || platform === 'discord' ? 'Join' : 'Follow';
    const label = PLATFORM_LABELS[platform] ?? 'the partner channel';
    return `${verb} ${handle || 'the partner'} on ${label}`;
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host ? `Open ${host}` : 'Open the partner page';
  } catch {
    return 'Open the partner page';
  }
}

export function validateRequirementInput(body = {}) {
  const errors = {};

  // The link is opened by participants, so it must be an absolute HTTPS URL.
  // A javascript: or data: scheme is refused before it can reach the page.
  const targetUrl = normalizeText(body.targetUrl);
  let parsedUrl = null;
  if (!targetUrl) {
    errors.targetUrl = 'Paste the partner link.';
  } else if (targetUrl.length > 500) {
    errors.targetUrl = 'Keep the link under 500 characters.';
  } else {
    try {
      parsedUrl = new URL(targetUrl);
      if (parsedUrl.protocol !== 'https:') errors.targetUrl = 'The link must start with https://';
    } catch {
      errors.targetUrl = 'That is not a valid URL.';
    }
  }

  // Platform: an explicit choice wins, otherwise it is read from the link's
  // domain, otherwise the link is a plain website to visit.
  const platformInput = normalizeText(body.platform).toLowerCase();
  const platform =
    platformInput === '' || platformInput === 'auto'
      ? (parsedUrl ? detectRequirementPlatform(targetUrl) : null) ?? 'website'
      : platformInput;
  if (!REQUIREMENT_PLATFORMS.includes(platform)) errors.platform = 'Unknown platform.';

  // Type: social platforms are follows, everything else is a link to open.
  const kindInput = normalizeText(body.kind);
  const kind =
    kindInput && REQUIREMENT_KINDS.includes(kindInput)
      ? kindInput
      : SOCIAL_PLATFORMS.includes(platform)
        ? 'social_follow'
        : 'visit_link';

  // Handle: explicit wins, otherwise taken from the link's path.
  const targetHandle = normalizeText(body.targetHandle) || deriveHandle(targetUrl, platform);
  if (targetHandle.length > 100) errors.targetHandle = 'Keep the handle under 100 characters.';

  // Title: explicit wins, otherwise generated from what the link is.
  const title = normalizeText(body.title) || autoTitle({ platform, kind, handle: targetHandle, url: targetUrl });
  if (title.length > 120) errors.title = 'Keep the title under 120 characters.';

  const description = normalizeText(body.description);
  if (description.length > 500) errors.description = 'Keep the note under 500 characters.';

  const positionRaw = normalizeText(body.position);
  let position = null;
  if (positionRaw !== '') {
    const parsed = Number.parseInt(positionRaw, 10);
    if (!/^\d+$/.test(positionRaw) || parsed < 1 || parsed > 20) {
      errors.position = 'Use a position between 1 and 20, or leave it blank.';
    } else {
      position = parsed;
    }
  }

  return {
    errors,
    value: {
      kind,
      platform,
      title,
      description,
      targetUrl,
      targetHandle,
      position,
      isRequired: body.isRequired === undefined ? true : Boolean(body.isRequired),
    },
  };
}

export function validateProofInput(value) {
  const proof = normalizeText(value);
  if (!proof) return { error: 'Enter the handle or link that proves the task was completed.' };
  if (proof.length < 2) return { error: 'That proof is too short.' };
  if (proof.length > 300) return { error: 'Keep the proof under 300 characters.' };
  return { value: proof };
}
