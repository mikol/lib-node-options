/**
 * @license Copyright 2010 Mikol Graves.
 * Available under a Creative Commons Attribution 4.0 International License.
 * See http://creativecommons.org/licenses/by/4.0/ for details.
 */

//------------------------------------------------------------------------------

/**
 * Minimalistic utility for parsing typical Unix command line options following
 * POSIX conventions, including support for GNU-style long options. Each command
 * line argument in `process.argv` will be parsed in order and classified as a
 * key or a value (the first 2 elements in `process.argv` will be skipped
 * because they will always be "node" and the name of the executed JavaScript
 * file; thus they are not user-specified options).
 * <ul>
 *   <li>Command line arguments are keys if they begin with a single or double
 *   hyphen delimiter ("-" or "--").</li>
 *
 *   <li>Keys that follow a single-hyphen delimiter must themselves be a single
 *   character each. Keys following a double hyphen must be at least two
 *   characters each and are typically one to three words long, with each word
 *   separated from the preceeding one by a hyphen.</li>
 *
 *   <li>Multiple single-character keys may follow a single-hyphen delimiter.
 *   For example, "-key" is equivalent to "-k -e -y".</li>
 *
 *   <li>Command line arguments that do not begin with a hyphen are values.</li>
 *
 *   <li>Keys may accept, require, or ignore a subsequent value argument.</li>
 *
 *   <li>A single character key and its corresponding value may or may not
 *   be separated by whitespace. For example, "-k value" and "-kvalue" are
 *   equivalent.</li>
 *
 *   <li>A single character key may also be separated from its corresponding
 *   value with an equal sign ("=") so that "-k value", "-kvalue", and
 *   "-k=value" are all equivalent.</li>
 *
 *   <li>A multi-character key must be separated from its corresponding value
 *   by either whitepsace or an equal sign ("="). For example, "--foo bar" and
 *   "--foo=bar" are equivalent, but "--foobar" is a discrete key named
 *   "foobar".</li>
 *
 *   <li>An argument whose value is exactly "-" indicates that options
 *   processing should stop. By convention, it is used to declare input from
 *   STDIN or output to STDOUT.</li>
 *
 *   <li>An argument whose value is exactly "--" indicates that any subsequent
 *   arguments should ne treated as values, even if they begin with a
 *   hyphen.</li>
 *
 *   <li>Keys and values may be supplied in any order and may appear multiple
 *   times. Their interpretation is left up to the implementor.</li>
 * </ul>
 * <p>
 * To use `options` call `options.next` in a loop. For
 * example:
 * </p>
 * <pre>
 *   var sys = require('sys');
 *   var options = require('options');
 *
 *   function processOptions(token, type) {
 *     if (type === options.KEY) {
 *       switch (token) {
 *         case 'e':          // -e
 *         case 'encrypt':    // --encrypt
 *           // Accept, but do not require, a specific cipher.
 *           var v = options.getOptional();
 *
 *           if (v != null) {
 *              if (/^AES|Blowfish|DSA|RSA$/.test(v)) {
 *               sys.debug('Output will be encrypted using the "' + v +
 *                         '" cipher.');
 *             } else {
 *               sys.debug('Unknown cipher "' + v + '".');
 *             }
 *           } else {
 *             sys.debug('Output will be encrypted using the default cipher.');
 *           }
 *
 *           break;
 *         case 'h':         // -h
 *         case 'help':      // --help
 *           sys.debug('This command will print a help message.');
 *           break;
 *         case 'v':         // -v
 *         case 'verbose':   // --verbose
 *           sys.debug('This command will execute verbosely.');
 *           break;
 *         default:
 *           sys.debug('Unknown key "' + token + '".');
 *       }
 *     } else if (type === options.VALUE) {
 *       sys.debug('This command will process "' + token + '".');
 *     } else if (type === options.IO) {
 *       sys.debug('This command will process input from STDIN or output to ' +
 *                 'STDOUT.');
 *     }
 *   }
 *
 *   while (options.next(processOptions));
 * </pre>
 *
 * @see http://www.gnu.org/software/libc/manual/html_node/Argument-Syntax.html
 */
var Options = exports;

//--------------------------------------------------------------------
// Constants

/**
 * @const
 * @type {String} A sentinel indicating that the next command line argument
 * is a key.
 */
Options.KEY = '{\b\0KEY}\b';

/**
 * @const
 * @type {String} A sentinel indicating that the next command line argument is
 * a value.
 */
Options.VALUE = '{\b\0VALUE}\b';

/**
 * @const
 * @type {String} A sentinel indicating that the next command line argument will
 * be input from STDIN or output to STDOUT.
 */
Options.IO = '{\b\0IO}\b';

//--------------------------------------------------------------------
// Variables

/**
 * @private
 * @type {Array.<String>} A copy of the command line options specified by
 * the caller.
 */
var _args = process.argv.slice(2);

/**
 * @private
 * @type {Boolean} Flag indicating that the command expects some arguments to be
 * keys, which is `true` by default; and `false` following a double-hyphen
 * token ("--").
 */
var _expectingKeys = true;

/**
 * @private
 * @type {Boolean} Flag indicating that the command may expect I/O from STDIN or
 * STDOUT following a single-hyphen token ("-").
 */
var _expectingIo = false;

/**
 * @private
 * @type {Boolean} Flag indicating that multiple characters follow a single-
 * hyphen delimiter. Depending on the caller's expectations, a bundle may be a
 * string of undelimited single-character keys (for example, `-key` as opposed
 * to `-k -e -y`), a single-character key plus a corresponding value (for
 * example, `-kvalue` as opposed to `-k value`), or both (for
 * example, `-eykvalue`).
 */
var _inBundle = false;

/**
 * @private
 * @type {Boolean} Flag indicating that the previous token parsed was a key and
 * that the next token is its corresponding value, which was declared
 * unambiguously by using an equal sign ("=") to separate the key and value
 * (for example, `--foo=bar` as opposed to `--foo bar`).
 *
 * @see #_inBundle
 * @see #getOptional
 */
var _beforeOptional = false;

//-------------------------------------------------------------------
// Methods

/**
 * Parse the next token from the command line and execute the specified
 * callback function.
 *
 * @param {Function} callback The method to execute for each token parsed from
 * the command line. `callback` should expect arguments representing
 * the token parsed and its type, which can be one of `Options.KEY`,
 * `Options.VALUE`, or `Options.IO`.
 *
 * @return {Boolean} `true` if there are more command line arguments
 * to process; `false` otherwise.
 *
 * @throws {Error} If there are arguments on the command line following a
 * single-hyphen token ("-").
 *
 * @throws {Error} If there are single-character keys on the command line that
 * follow a double-hyphen delimiter ("--").
 *
 * @see #getValue
 */
Options.next = function (callback) {
  if (_args.length < 1) {
    return false;
  }

  var n = _next();
  var t = null;

  if (n === Options.VALUE) {
    t = n;
    n = Options.getValue();
  } else if (_expectingKeys) {
    t = Options.KEY;
  } else if (_expectingIo) {
    t = Options.IO;
  } else {
    t = Options.VALUE;
  }

  callback(n, t);

  return (_args.length > 0);
};

/**
 * Implements core processing logic for `next()`.
 *
 * @see #next
 * @private
 */
function _next() {
  var o;

  if (_args.length === 0) {
    return null;
  }

  if (_args[0] === '-') {
    _expectingIo = true;
    _expectingKeys = false;
    _args.shift();

    if (_args.length > 0) {
      throw Error('Expected input or output, but found command line ' +
          'arguments after hyphen ("-") token.');
    }

    return null;
  }

  if (!_expectingKeys) {
    return _args.shift();
  }

  if (_args[0] === '--') {
    _expectingKeys = false;
    _args.shift();
    return _next();
  }

  if (_args[0].indexOf('-') === 0) {
    o = _args.shift();

    var e = o.indexOf('=');

    if (e > -1) {
      var r = o.substr(e + 1);
      o = o.substring(0, e);

      if (r !== '') {
        _beforeOptional = true;
        _args.unshift(r);
      }
    }

    if (o.indexOf('--') === 0) {
      if (o.length < 4) {
        throw Error('Expected a multi-character key to follow a double ' +
            'hyphen ("--"), but found a single character key "' + o + '".');
      }
      return o.substr(2);
    } else if (o.length === 2) {
      _inBundle = false;
      return o.substr(1);
    } else {
      _inBundle = true;
      _args.unshift('-' + o.substr(2));
      return o.substr(1,1);
    }
  }

  return Options.VALUE;
}

/**
 * Parse the next value from the command line. `getValue` is useful if the
 * previous token is a key that requires a value.
 *
 * @return {String|null} The next command line argument&mdash;if one is
 * available and it is not a key; `null` otherwise.
 */
Options.getValue = function () {
  _beforeOptional = false;

  if (_args.length === 0 || (!_inBundle && _args[0].indexOf('-') === 0)) {
    return null;
  }

  var o = _args.shift();

  if (_inBundle) {
    _inBundle = false;
    return o.substr(1);
  }

  return o;
};

/**
 * Parse the next value from the command line if, and only if, it is part of a
 * series of characters following a single-hyphen delimiter (for example,
 * `-kvalue`) or it is separated from the preceding token by an equal sign (for
 * example, `--foo=bar`). `getOptional` is useful if the previous token is a key
 * that accepts, but doesn't require, a value.
 *
 * @return {String|null} The next command line argument&mdash;if one is
 * available and it is unambiguously attached to the preceding key;
 * `null` otherwise.
 */
Options.getOptional = function () {
  if (_beforeOptional || _inBundle) {
    return Options.getValue();
  }

  return null;
};

//------------------------------------------------------------------------------

if (process.argv[1] === __filename) {
  (function test () {
    var sys = require('sys');
    var options = Options;
    sys.debug(process.argv);
    sys.debug(_args);

    function processOptions(token, type) {
      sys.debug(token + ' : ' + type + ' : ' + _args);
      if (type === options.KEY) {
        switch (token) {
          case 'e':          // -e
          case 'encrypt':    // --encrypt
            // Accept, but do not require, a specific cipher.
            var v = options.getOptional();

            if (v != null) {
              if (/^AES|Blowfish|DSA|RSA$/.test(v)) {
                sys.debug('Output will be encrypted using the "' + v +
                          '" cipher.');
              } else {
                sys.debug('Unknown cipher "' + v + '".');
              }
            } else {
              sys.debug('Output will be encrypted using the default cipher.');
            }

            break;
          case 'h':         // -h
          case 'help':      // --help
            sys.debug('This command will print a help message.');
            break;
          case 'v':         // -v
          case 'verbose':   // --verbose
            sys.debug('This command will execute verbosely.');
            break;
          default:
            sys.debug('Unknown key "' + token + '".');
        }
      } else if (type === options.VALUE) {
        sys.debug('This command will process "' + token + '".');
      } else if (type === options.IO) {
        sys.debug('This command will process input from STDIN or output ' +
                  'to STDOUT.');
      }
    }

    while (options.next(processOptions)) {}
  })();
}
