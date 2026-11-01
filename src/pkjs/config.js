// Appearance settings page, built with Clay (@rebble/clay), plus the helpers
// that turn the page's answers into the 'appearance' AppMessage.

var APPEARANCE_KEYS = [
  'Theme', 'AccentColor', 'ChatBgColor', 'OutBubbleColor', 'BgPattern',
  'TextSize', 'TextBold', 'ShowPhotos', 'BigEmoji'
];

var config = [
  {
    type: 'section',
    items: [
      {type: 'heading', defaultValue: 'Telegram account'},
      {type: 'text', defaultValue: 'Log in, switch account or edit quick replies.'},
      {type: 'button', id: 'telegramAccount', defaultValue: 'Telegram account settings'}
    ]
  },
  {
    type: 'section',
    items: [
      {type: 'heading', defaultValue: 'Theme'},
      {
        type: 'radiogroup',
        messageKey: 'Theme',
        defaultValue: '0',
        options: [
          {label: 'Light', value: '0'},
          {label: 'Dark', value: '1'}
        ]
      }
    ]
  },
  {
    // Colour pickers only appear for colour watches.
    type: 'section',
    capabilities: ['COLOR'],
    items: [
      {type: 'heading', defaultValue: 'Colours'},
      {
        type: 'color',
        messageKey: 'AccentColor',
        label: 'Accent (header, links, selection)',
        defaultValue: '0055AA'
      },
      {
        type: 'color',
        messageKey: 'ChatBgColor',
        label: 'Chat background',
        defaultValue: '55AA55'
      },
      {
        type: 'color',
        messageKey: 'OutBubbleColor',
        label: 'Your message bubbles',
        defaultValue: 'AAFFAA'
      }
    ]
  },
  {
    type: 'section',
    items: [
      {type: 'heading', defaultValue: 'Chat'},
      {
        type: 'select',
        messageKey: 'BgPattern',
        label: 'Background pattern',
        defaultValue: '0',
        options: [
          {label: 'Doodles', value: '0'},
          {label: 'Dots', value: '1'},
          {label: 'Diagonal lines', value: '2'},
          {label: 'Grid', value: '3'},
          {label: 'None', value: '4'}
        ]
      },
      {
        type: 'select',
        messageKey: 'TextSize',
        label: 'Message text size',
        defaultValue: '1',
        options: [
          {label: 'Small', value: '0'},
          {label: 'Medium', value: '1'},
          {label: 'Large', value: '2'},
          {label: 'Extra large', value: '3'}
        ]
      },
      {
        type: 'radiogroup',
        messageKey: 'TextBold',
        label: 'Message text style',
        defaultValue: '0',
        options: [
          {label: 'Regular', value: '0'},
          {label: 'Bold', value: '1'}
        ]
      },
      {type: 'toggle', messageKey: 'ShowPhotos', label: 'Show profile photos', defaultValue: true},
      {type: 'toggle', messageKey: 'BigEmoji', label: 'Big emoji messages', defaultValue: true}
    ]
  },
  {type: 'submit', defaultValue: 'Save'}
];

// Runs inside the settings page (Clay serialises it), so it cannot use
// anything from this file. The login page is told where to return to, so it can
// still close the page and hand its answer to the phone.
function pageScript() {
  var clay = this;
  clay.on(clay.EVENTS.AFTER_BUILD, function() {
    clay.getItemById('telegramAccount').on('click', function() {
      var url = clay.meta.userData.loginUrl;
      if (window.returnTo) {
        url += '&return_to=' + encodeURIComponent(window.returnTo);
      }
      window.location.href = url;
    });
  });
}

// The login page answers with JSON {mode: 'pgjs', ...}; anything else that
// closes the page came from Clay. Returns the login answer, or null.
function parseLoginResponse(response) {
  var data;
  try {
    data = JSON.parse(decodeURIComponent(response));
  } catch (e) {
    return null;
  }
  return data && data.mode === 'pgjs' ? data : null;
}

// Clay settings ({key: {value}} fresh from the page, {key: value} when saved)
// to a payload with one message key per setting; null when there is nothing.
function appearancePayload(settings, messageKeys) {
  var payload = {};
  var found = false;
  APPEARANCE_KEYS.forEach(function(name) {
    var value = settings && settings[name];
    if (value && typeof value === 'object') {
      value = value.value;
    }
    if (typeof value === 'boolean') {
      value = value ? 1 : 0;
    }
    value = value === undefined || value === null || value === '' ? NaN : Number(value);
    if (!isNaN(value)) {
      payload[messageKeys[name]] = Math.floor(value);
      found = true;
    }
  });
  if (!found) {
    return null;
  }
  payload[messageKeys.Type] = 'appearance';
  return payload;
}

module.exports = {
  config: config,
  pageScript: pageScript,
  parseLoginResponse: parseLoginResponse,
  appearancePayload: appearancePayload
};
