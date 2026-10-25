import { defineTexts } from '../core/text';

/**
 * Member-facing wording of the troubleshooting module (/troubleshoot, /diagnose,
 * /knowledge-search). Knowledge-base articles, flows and analyzer findings are
 * content stored elsewhere and are not part of this catalogue.
 */
export const TroubleshootingText = defineTexts('troubleshooting', {
  // ── Support / escalation ──
  supportWithLink: {
    default: 'Still stuck? Contact the support team: {url}',
    help: 'Escalation line when a support link is configured. {url} is the support link.',
    vars: ['url'],
  },
  supportNoLink: {
    default: 'Still stuck? Please contact the support team.',
    help: 'Escalation line when no support link is configured.',
  },
  contactSupportButton: {
    default: 'Contact support',
    help: 'Link button that opens the support page.',
    kind: 'label',
  },
  escalatedTitle: {
    default: 'Let’s get you to the support team',
    help: 'Title of the embed shown when a member is still stuck.',
    kind: 'title',
  },
  escalatedFlowHint: {
    default: 'Please include the game, what you tried in this guide, and any error messages.',
    help: 'Shown under the support line when a guided flow ends in escalation.',
  },
  escalatedHint: {
    default:
      'Please include the game, what you already tried, and any error messages. Never share passwords.',
    help: 'Shown under the support line after pressing Still stuck.',
  },

  // ── Articles ──
  articleFooterRated: {
    default: '{percent}% found this helpful · general guidance, not a guarantee',
    help: 'Footer of a knowledge-base article that has votes.',
    vars: ['percent'],
    kind: 'short',
  },
  articleFooterUnrated: {
    default: 'General guidance — your setup may differ',
    help: 'Footer of a knowledge-base article without votes yet.',
    kind: 'short',
  },
  helpedButton: {
    default: 'This helped',
    help: 'Feedback button under an article or log analysis.',
    kind: 'label',
  },
  stillStuckButton: {
    default: 'Still stuck',
    help: 'Button under an article, flow result or log analysis that leads to support.',
    kind: 'label',
  },
  openArticleButton: {
    default: 'Open full article',
    help: 'Link button to the full article online.',
    kind: 'label',
  },
  readArticleButton: {
    default: 'Read article',
    help: 'Button at the end of a guided flow that opens the related article.',
    kind: 'label',
  },
  articleVoteThanks: {
    default: 'Thanks for the feedback — glad it helped!',
    help: 'Reply after a member presses This helped on an article.',
  },
  articleAlreadyRated: {
    default: 'You already rated this article. Thanks for the feedback!',
    help: 'Shown when a member rates the same article twice in a day.',
  },

  // ── Knowledge search ──
  searchTitle: {
    default: 'Knowledge base',
    help: 'Title of /knowledge-search when nothing matched.',
    kind: 'title',
  },
  searchNoResults: {
    default:
      'No articles matched **{query}**. Try fewer or different words, use `/troubleshoot` for a guided check, or contact the support team.',
    help: '/knowledge-search reply when nothing matched. {query} is what the member searched for.',
    vars: ['query'],
  },
  searchResultsTitle: {
    default: 'Knowledge base · {count} result{plural}',
    help: 'Title of /knowledge-search results. {plural} is "s" unless there is exactly one.',
    vars: ['count', 'plural'],
    kind: 'title',
  },
  searchResultsFooter: {
    default: 'Press a button to read an article here.',
    help: 'Footer of /knowledge-search results.',
    kind: 'short',
  },

  // ── Guided flows ──
  noFlowsTitle: {
    default: 'Troubleshooting',
    help: 'Title of /troubleshoot when no guide exists for the game.',
    kind: 'title',
  },
  noFlowsDescription: {
    default:
      'No guided troubleshooting is available for that game yet. Try `/knowledge-search` or `/diagnose` with your log file.',
    help: '/troubleshoot reply when no guide exists for the game.',
    kind: 'long',
  },
  flowPickerTitle: {
    default: 'Guided troubleshooting',
    help: 'Title of the /troubleshoot problem picker.',
    kind: 'title',
  },
  flowPickerDescription: {
    default: 'Pick the problem that matches yours. Only you can see and answer these steps.',
    help: 'Description of the /troubleshoot problem picker.',
    kind: 'long',
  },
  flowPickerPlaceholder: {
    default: 'Choose a problem…',
    help: 'Placeholder of the /troubleshoot problem menu.',
    kind: 'short',
  },
  stepRelated: {
    default: '📄 Related: {article}',
    help: 'Line under a flow step that links a related article. {article} is the article title and summary.',
    vars: ['article'],
  },
  resolvedWithArticleTitle: {
    default: 'This should help',
    help: 'Title when a guided flow ends with an article.',
    kind: 'title',
  },
  resolvedTitle: {
    default: 'Glad that’s sorted!',
    help: 'Title when a guided flow ends without an article.',
    kind: 'title',
  },
  resolvedWithArticle: {
    default: '{article}\n\nIf this does not solve it, press **Still stuck**.',
    help: 'Description when a guided flow ends with an article. {article} is the article title and summary.',
    vars: ['article'],
    kind: 'long',
  },
  resolvedDescription: {
    default: 'Great — you are all set. If the problem comes back, run `/troubleshoot` again.',
    help: 'Description when a guided flow ends without an article.',
    kind: 'long',
  },
  flowMisconfigured: {
    default: 'This troubleshooting flow is misconfigured. Please contact the support team.',
    help: 'Error when a stored flow is broken.',
  },
  sessionNotOwner: {
    default:
      'Only the member who started this troubleshooting session can continue it. Run /troubleshoot to start your own.',
    help: "Error when someone presses buttons on another member's guide.",
  },
  sessionEnded: {
    default: 'This troubleshooting session has ended. Run /troubleshoot to start again.',
    help: 'Error when a finished guide is used again.',
  },
  sessionExpired: {
    default: 'This troubleshooting session has expired. Run /troubleshoot to start again.',
    help: 'Error when an abandoned guide is escalated.',
  },
  stepStale: {
    default: 'That step is no longer current — use the latest message.',
    help: 'Error when an old step button is pressed.',
  },
  flowChanged: {
    default: 'This flow was updated while you were using it. Please run /troubleshoot again.',
    help: 'Error when staff edit a guide while a member is using it.',
  },
  optionMissing: {
    default: 'That option does not exist.',
    help: 'Error when a guide option no longer exists.',
  },
  stepAlreadyAnswered: {
    default: 'That step was already answered.',
    help: 'Error when a guide step is answered twice at once.',
  },

  // ── /diagnose ──
  uploadWarning: {
    default:
      'Logs may contain sensitive data; we automatically redact credentials and IPs; never upload files containing passwords.',
    help: 'Privacy warning shown with log uploads and under every log analysis.',
  },
  uploadWarningTitle: {
    default: 'Before you upload a log',
    help: 'Title of the upload privacy warning.',
    kind: 'title',
  },
  diagnosisFooter: {
    default: '{warning} Stored summary expires {time}.',
    help: 'Footer of a log analysis. {warning} is the upload privacy warning, {time} the expiry (UTC).',
    vars: ['warning', 'time'],
  },
  noIssueTitle: {
    default: 'No known issue detected',
    help: 'Title of /diagnose when no known problem was found.',
    kind: 'title',
  },
  noIssueDescription: {
    default:
      'I checked **{file}** against known {game}problems and did not find a match. That does not mean the log is fine — it may be an issue I do not recognise yet.\n\nTry `/troubleshoot` or `/knowledge-search`, or press **Still stuck** to contact the support team.',
    help: '/diagnose reply when no known problem was found. {file} is the file name, {game} the game name followed by a space (empty when unknown).',
    vars: ['file', 'game'],
    kind: 'long',
  },
  diagnosisTitle: {
    default: 'Log analysis · {count} finding{plural}',
    help: 'Title of /diagnose results. {plural} is "s" unless there is exactly one.',
    vars: ['count', 'plural'],
    kind: 'title',
  },
  diagnosisDescription: {
    default:
      'Results for **{file}**. These are likely causes based on known log patterns — not a confirmed diagnosis.',
    help: 'Description of /diagnose results. {file} is the file name.',
    vars: ['file'],
    kind: 'long',
  },
  likelyCause: {
    default: 'Likely cause',
    help: 'Prefix of a high-confidence finding in a log analysis.',
    kind: 'short',
  },
  possibleCause: {
    default: 'Possible cause',
    help: 'Prefix of a lower-confidence finding in a log analysis.',
    kind: 'short',
  },
  guideButton: {
    default: 'Guide: {guide}',
    help: 'Button under a log analysis that opens a related guide. {guide} is the guide name.',
    vars: ['guide'],
    kind: 'label',
  },
  diagnosisFeedbackThanks: {
    default: 'Great — thanks for letting us know!',
    help: 'Reply after a member presses This helped on a log analysis.',
  },
  diagnosisNotOwner: {
    default: 'Only the member who uploaded this file can respond.',
    help: "Error when someone presses feedback buttons on another member's log analysis.",
  },
  fileTypeInvalid: {
    default: 'Only .log or .txt files can be analysed (for example latest.log or crash-reports/crash-….txt).',
    help: '/diagnose error for a file that is not .log or .txt.',
  },
  fileEmpty: {
    default: 'That file is empty.',
    help: '/diagnose error for an empty file.',
  },
  fileTooLarge: {
    default:
      'That file is larger than 1 MB. Upload just the relevant log (e.g. latest.log) or a crash report.',
    help: '/diagnose error for a file over 1 MB.',
  },
  fileTooLargeShort: {
    default: 'That file is larger than 1 MB.',
    help: '/diagnose error when the download exceeds 1 MB.',
  },
  fileNotText: {
    default: 'That file does not look like a plain-text log.',
    help: '/diagnose error for a file that is not a text file.',
  },
  fileBinary: {
    default: 'That file looks binary, not a text log. Please upload a .log or .txt file saved as UTF-8.',
    help: '/diagnose error for a binary file.',
  },
  fileNotDiscord: {
    default: 'Attachments must be uploaded directly to Discord.',
    help: '/diagnose error for a file not hosted on Discord.',
  },
  downloadFailed: {
    default: 'Could not download the file from Discord. Please try again.',
    help: '/diagnose error when the file could not be downloaded.',
  },
  downloadTimeout: {
    default: 'Downloading the file took too long. Please try again.',
    help: '/diagnose error when the download timed out.',
  },
});
