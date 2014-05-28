var util = require('util');
var EventEmitter = require('events').EventEmitter;
var clone = require('_structured_clone');

var tm = process.binding('tm');
var hw = process.binding('hw');

var tessel_version = process.versions.tessel_board;

// var _interruptModes = {
//   0 : 'rise',
//   1 : 'fall',
//   2 : 'high',
//   3 : 'low',
//   4 : 'change'
// };

process.on('raw-message', function (buf) {
  try {
    process.emit('message', clone.deserialize(buf));
  } catch (e) { }
});

process.send = function (msg) {
  hw.usb_send('M'.charCodeAt(0), clone.serialize(msg));
};


/**
 * util
 */

function propertySetWithDefault (provided, possibility, defaultProp) {
  if (!provided) {
    return defaultProp;
  } 
  else {
    if (verifyParams(possibility, provided)) {
      return provided;
    } else {
      throw new Error('Invalid property value');
    }
  }
}

function verifyParams (possible, provided) {
  for (var obj in possible) {
    if (possible[obj] == provided) {
      return true;
    }
  }
  return false;
}

/**
 * Interrupt
 */

function Interrupt(mode, id) {
  this.mode = mode;
  this.id = id;
}

function _triggerTypeForMode(mode) {

  switch(mode) {
    case "high":
    case "low" :
      return "level";
    case "rise":
    case "fall":
    case "change":
      return "edge";
    default:
      return;
  }
}

var _bitFlags = {
  "rise" : (1 << 0),
  "fall" : (1 << 1),
  "change" : (1 << 1 | 1 << 0),
  "high" : (1 << 2),
  "low" : (1 << 3)
};

/**
 * Pins
 */


var pinModes = {
  pullup: hw.PIN_PULLUP,
  pulldown: hw.PIN_PULLDOWN,
  none: hw.PIN_DEFAULT
}

// IPC Routing for emitting GPIO Interrupts
process.on('interrupt', function interruptFired(interruptId, mode, time) {
  console.log('checking board for pin...');
  var pin = board.interrupts[interruptId];
  console.log('found the pin', pin);
  if (pin) {
    var triggerType = _triggerTypeForMode(mode)
    
    // If we have interrupts enabled for this trigger type 
    // (it could have just changed prior to this IPC)
    if (pin.interrupts[triggerType]) {
      // If the mode of the interrupt for this trigger type is change
      if (pin.interrupts[triggerType].mode === _bitFlags['change']) {
        console.log('we were waiting for change!');
        pin.emit('change', time, mode);
      }
      // Emit the activated mode
      console.log('emitting the normal stuff...', mode, time);
      pin.emit(mode, time, mode);
    }
  }
});


function Pin (pin) {
  this.pin = pin;
  this.interrupts = {};
}

util.inherits(Pin, EventEmitter);

Pin.prototype.removeAllListeners = function(event) {
  var emitter = Pin.super_.prototype.removeAllListeners.call(this, event);

  if (!Array.isArray(event)) {
    // If it's an interrupt event, remove as necessary
    _interruptRemovalCheck(event);
  } 

  return emitter;
}

Pin.prototype.removeListener = function(event, listener) {

  // Call the regular event emitter method
  var emitter = Pin.super_.prototype.removeListener.call(this, event, listener);

  // If it's an interrupt event, remove as necessary
  _interruptRemovalCheck(event);

  return emitter;
}

// Listen for GPIO Interrupts (edge triggered and level triggered)
Pin.prototype.once = function(mode, callback) {

  // Sanitize
  var type = _triggerTypeForMode(mode);

  // If this is a valid interrupt
  if (type) {

    // Attempt to register the interrupt
    _registerPinInterrupt(this, type, mode);

    // Bool that represents that this interrupt was already registered inside of 'once'
    // because the super_ call to 'once' will call 'on' and we don't want to
    // double register or throw an error if it's a level interrupt
    console.log('registered once...');
    this.__onceRegistered = true;
  }

  // Once registered, add to our event listeners
  Pin.super_.prototype.once.call(this, mode, callback);
}

// Listen for GPIO Interrupts (edge triggered)
Pin.prototype.on = function(mode, callback) {

  // Sanitize
  var type = _triggerTypeForMode(mode);

  // Make sure this isnt a level int b/c they can only use 'on'
  if (type === "level" && !this.__onceRegistered) {
    // Throw an error
    _errorRoutine(this, new Error("You cannot use 'on' with level interrupts. You can only use 'once'."));
  }
  // This is a valid event
  else {

    // If it is an edge trigger (and we didn't already register a level in 'once')
    if (type && !this.__onceRegistered) {

      // Register the pin with the firmware and our data structure
      _registerPinInterrupt(this, type, mode);
    }

    // Clear the once register
    this.__onceRegistered = false;

    // Add the event listener
    Pin.super_.prototype.on.call(this, mode, callback);
  }
}

function _interruptRemovalCheck (event) {
  // Check if this is an interrupt mode
  console.log('checking', event, 'for removal');  
  var type = _triggerTypeForMode(event);

  // If it is, and the listener count is now zero
  if (mode != -1 && !EventEmitter.listenerCount(this, event)) {
    console.log('no more listeners for mode: ', type);
    // Remove this interrupt
    _removeInterruptMode(this, type, event);
  }

}

function _removeInterruptMode(pin, type, mode) {
  // Get the responsible interrupt object
  var interrupt = pin.interrupts[type];

  // If the interrupt still exists
  if (interrupt) {
    console.log('found interrupt', interrupt);
    // Clear this bit from the mode
    console.log('setting ', interrupt.mode, ' to ', _bitFlags[mode]);
    interrupt.mode &= ~(_bitFlags[mode]);
    console.log('mode afterward', interrupt.mode);

    // Clear the interrupt in HW
    // hw.interrupt_unwatch(interrupt.id, _bitFlags[mode]);
    masterid = masterid-1;

    // If there are no more interrupts being watched
    if (!interrupt.mode) {
      console.log('deleting int');
      // Delete this interrupt from the pin dict
      delete pin.interrupts[type];
    }

    console.log('int afterward', pin.interrupts);
  }
}

function _errorRoutine(pin, error) {

  // If we have an error listener
  if (EventEmitter.listenerCount(pin, 'error')) {
    // Emit the event
    pin.emit('error', error);
  }
  // If there is no listener
  else {
    // throw the event...
    throw error;
  }
}

function _registerPinInterrupt(pin, type, mode) {

  // Check if this pin is already watching this type of interrupt
  var match = pin.interrupts[type];

  console.log('already watching?', match);
  // If it is, check if we are already listening for this type ('edge' vs 'level')
  if (match) {
    // Then check if we are not already listening for this type (eg 'high' vs 'low')
    if (!(match.mode & _bitFlags[mode])) {
      console.log('new mode!', mode);

      // Add this mode to our interrupt
      match.mode |= _bitFlags[mode];

      // Tell the Interrupt driver to start listening for this type
      // hw.interrupt_watch(match.id, match.mode);
    }
  }
  // We weren't already listening for this interrupt type
  // We will need a new interrupt
  else {
    console.log('no match...');
    // var intId = hw.interrupt_acquire();
    var intId = _fakeAcquire();
    console.log('new id', intId);
    if (intId === -1) {
      _errorRoutine(this, new Error("All eight interrupts are currently active."));

      return;
    }
    else {
      // Create a new interrupt object
      var interrupt = new Interrupt(_bitFlags[mode], intId);
      console.log('made int', interrupt);

      // Add it to this pin's interrupts, index by type ('level' or 'edge')
      console.log('setting ', type, 'to', interrupt);
      pin.interrupts[type] = interrupt;

      // Keep a reference in our boards data structure
      // so that we can easily find the correct pin on IPC
      board.interrupts[intId]= pin;
      console.log('setting timeout...', pin);
      // Tell the firmware to start watching for this interrupt
      // hw.interrupt_watch(intId, mode);
    }
  }
}

var masterid = 0;
function _fakeAcquire(intid) {
  masterid++;

  if (masterid > 7) {
    return -1;
  }
  else {
    return masterid;
  }
}


Pin.prototype.type = 'digital';
Pin.prototype.resolution = 1;

Pin.prototype.pull = function(mode){
  if (!mode) {
    mode = 'none';
  }

  mode = mode.toLowerCase();

  if (Object.keys(pinModes).indexOf(mode.toLowerCase()) == -1) {
    throw new Error("Pin modes can only be 'pullup', 'pulldown', or 'none'");
  }

  hw.digital_set_mode(this.pin, pinModes[mode]);
  return this;
}

Pin.prototype.mode = function(){
  var mode = hw.digital_get_mode(this.pin);

  if (mode == pinModes.pullup) {
    return 'pullup';
  } else if (mode == pinModes.pulldown) {
    return 'pulldown'
  } else if (mode == pinModes.none){
    return 'none';
  } 

  console.warn('Pin mode is unsupported:', mode);
  return null;
}

Pin.prototype.rawDirection = function (isOutput) {
  if (isOutput) {
    hw.digital_output(this.pin);
  } else {
    hw.digital_input(this.pin);
  }
  return this;
};

Pin.prototype.rawRead = function rawRead() {
  return hw.digital_read(this.pin);
};

Pin.prototype.rawWrite = function rawWrite(value) {
  hw.digital_write(this.pin, value ? hw.HIGH : hw.LOW);
  return this;
};


Pin.prototype.output = function output(value) {
  this.rawWrite(value);
  this.rawDirection(true);
  return this;
};

Pin.prototype.input = function input() {
  this.rawDirection(false);
  return this;
};

Pin.prototype.setInput = function (next) {
  console.warn('pin.setInput is deprecated. Use pin.input()');
  hw.rawDirection(false);
  if (next) {
    setImmediate(next);
  }
  return this;
};

Pin.prototype.setOutput = function (initial, next) {
  console.warn('pin.setOutput is deprecated. Use pin.output()');

  if (typeof initial == 'function') {
    next = initial;
    initial = false;
  }

  this.output(initial);

  if (next) {
    setImmediate(next);
  }

  return this;
};

Pin.prototype.read = function (next) {
  this.rawDirection(false);
  var value = this.rawRead();

  if (next) {
    console.warn('pin.read is now synchronous. Use of the callback is deprecated.');
    setImmediate(function() { next(value); });
  }
  return value;
};

Pin.prototype.readSync = function(value) {
  console.warn('pin.readSync() is deprecated. Use pin.read() instead.');
  return this.read();
};

Pin.prototype.write = function (value, next) {
  this.rawWrite(value);
  this.rawDirection(true);

  if (next) {
    console.warn('pin.write is now synchronous. Use of the callback is deprecated.');
    setImmediate(next);
  }
  return null;
};

Pin.prototype.writeSync = function(value) {
  console.warn('pin.writeSync() is deprecated. Use pin.write() instead.');
  return this.write(value);
};

Pin.prototype.high = function () {
  this.output(true);
  return this;
};

Pin.prototype.low = function () {
  this.output(false);
  return this;
};

Pin.prototype.pulse = function () {
  this.high();
  this.low();
};

Pin.prototype.toggle = function () {
  this.output(!this.rawRead());
};

Pin.prototype.set = function (v) {
  console.warn("pin.set() is deprecated. Use this.rawWrite(v) or this.output(v)");
  this.rawWrite(v);
  return this;
};

Pin.prototype.pwm = function (frequency, dutyCycle)
{
  // frequency is in hertz, on time is a percent
  var period = 1/(frequency/180000000);

  if (dutyCycle > 1) dutyCycle = 1;
  if (dutyCycle < 0) dutyCycle = 0;

  var pulsewidth = dutyCycle*period;

  if (hw.pwm(this.pin, hw.PWM_EDGE_HI, period, pulsewidth) !== 0) {
    throw new Error("PWM is not supported on this pin");
  }
};


/**
 * Analog pins
 */

function AnalogPin (pin) {
  this.pin = pin;
  this.pinmode = 'input';
}

var ANALOG_RESOLUTION = 1024;

AnalogPin.prototype.type = 'analog';

AnalogPin.prototype.resolution = ANALOG_RESOLUTION;

AnalogPin.prototype.write = function (val) {
  if (tessel_version <= 2 && this.pin != hw.PIN_E_A4) {
    return console.warn("Only A4 can write analog signals");
  } else if (tessel_version == 3 && this.pin != hw.PIN_E_A1){
    return console.warn("Only A1 can write analog signals");
  }

  val = (val < 0 ? 0 : (val > 1 ? 1 : val)) * ANALOG_RESOLUTION;
  hw.analog_write(this.pin, val);
};

AnalogPin.prototype.readSync = function () {
  console.warn('analogpin.readSync() is deprecated. Use analogpin.read() instead.');
  return this.read();
};

AnalogPin.prototype.read = function (next) {
  return hw.analog_read(this.pin) / ANALOG_RESOLUTION;
};


/**
 * Interrupts
 */

// Event for GPIO interrupts
// process.on('interrupt', function (index, _mode, state) {
//   // Grab the interrupt generating message
//   var mode = _interruptModes[_mode];

//   // Grab corresponding pin
//   var assigned = board.interrupts[index];

//   // If it exists and nothing went crazy
//   if (assigned) {

//     // Check if there are callbacks assigned for this mode or "change"
//     var callbacks = assigned.modes[mode].callbacks;

//     // If this is a rise or fall event, call change callbacks as well
//     if (mode === "change") {

//       if (state === 1) {
//         callbacks.concat(assigned.modes.rise.callbacks);
//         assigned.pin.emit('change', null, 0, 'low');
//         assigned.pin.emit('rise', null, 0, 'rise');
//       } 
//       else {
//         callbacks.concat(assigned.modes.low.callbacks);
//         assigned.pin.emit('change', null, 0, 'low');
//         assigned.pin.emit('low', null, 0, 'low');
//       }
//     }
//     else {
//       assigned.pin.emit(mode);
//     }

//     // If it's a high or low event, clear that interrupt (should only happen once)
//     // This happens before the callback so the callback can re-arm the interrupt.
//     if (mode == 'high' || mode == 'low') {
//       delete board.interrupts[index];
//       hw.interrupt_unwatch(index, mode);
//     }

//     // If there are, call them
//     for (var i = 0; i < callbacks.length; i++) {
//       callbacks[i].bind(assigned.pin, null, 0, mode)();
//     }
//   }
// });

// Pin.prototype.watch = function(mode, callback) {

//   // Make sure trigger mode is valid
//   mode = mode.toLowerCase();
//   if (interruptModeForType(mode) == -1) {
//     return callback && callback.bind(this, new Error("Invalid trigger: " + mode))();
//   }
  
//   // Check if this pin already has an interrupt associated with it
//   var interrupt = hw.interrupt_assignment_query(this.pin);

//   // If it does not have an assignment
//   if (interrupt === -1) {

//     // Attempt to acquire next available
//     interrupt = hw.acquire_available_interrupt();

//     if (interrupt === -1) {
//       console.warn("There are no interrupts remaining...");
//       // Throw an angry Error
//       return callback && callback(new Error("All GPIO Interrupts are already assigned."));
//     }

//   }

//   // Assign this pin with this trigger mode to the interrupt
//   return this.assignInterrupt(mode, interrupt, callback);
// };

// function interruptModeForType(triggerMode) {
//   for (var mode in _interruptModes) {
//     if (_interruptModes[mode] === triggerMode) {
//       return mode;
//     }
//   }
//   return -1;
// }

// Pin.prototype.assignInterrupt = function(triggerMode, interrupt, callback) {
  
//   // Start watching pin for edges
//   var success = hw.interrupt_watch(this.pin, interrupt, interruptModeForType(triggerMode));

//   // If there was no error
//   if (success != -1) {
   
//     // Set the assignment on the board object
//     // Grab what the current assignment is
//     var assignment = board.interrupts[interrupt];

//     // If there is something assigned 
//     if (assignment) {

//       // If the watch is being removed
//       if (triggerFlag == -1) {

//         // Just remove the entity
//         delete board.interrupts[interrupt];
//       }
//       // If we're adding the mode
//       else {
//         // Add it to the array
//         assignment.addModeListener(triggerMode, callback);
//       }
//     }
//     // If not, assign with new data structure
//     else {
//       // Create the object
//       assignment = new InterruptAssignment(this, triggerMode, callback);

//       // Shove it into the data structure
//       board.interrupts[interrupt] = assignment;
//     }
//   } 
//   // If not successful watching...
//   else {

//     // Throw the error in callback
//     if (callback) {
//       callback.bind(this, new Error("Unable to wait for interrupts on pin"))();
//     }
//     return -1;
//   }

//   return 1;
// };

// function InterruptAssignment(pin, mode, callback) {
//   // Save the pin object
//   this.pin = pin;

//   // Create a modes obj with each possible mode
//   this.modes = {};
//   this.modes.rise = {listeners : 0, callbacks : []};
//   this.modes.fall= {listeners : 0, callbacks : []};
//   this.modes.change = {listeners : 0, callbacks : []};
//   this.modes.high = {listeners : 0, callbacks : []};
//   this.modes.low = {listeners : 0, callbacks : []};

//   // Increment number of listeners
//   this.modes[mode].listeners = 1;

//   // Add the callback to the appropriate mode callback array
//   if (callback) {
//     this.modes[mode].callbacks.push(callback);
//   }
// }

// InterruptAssignment.prototype.addModeListener = function(mode, callback) {
//   // Grab the mode object
//   var modeObj = this.modes[mode];

//   // Increment number of listeners
//   modeObj.listeners++;

//   // If a callback was provided
//   if (callback) {

//     // Add it to the array
//     modeObj.callbacks.push(callback);
//   }
// };

// Pin.prototype.cancelWatch = function(mode, callback){

//   if (!mode) {
//     return callback && callback(new Error("Need to specify trigger Type to cancel."));
//   }
//   // Check which modes are enabled by grabbing this interrupt
//   var interruptID = hw.interrupt_assignment_query(this.pin);

//   // If this has an interrupt associated with it
//   if (interruptID != -1) {

//     // Grab the JS assignment
//     var assignment = board.interrupts[interruptID];

//     if (assignment) {
            
//       delete board.interrupts[interruptID];

//       // Watch with a -1 flag to tell it to stop watching
//       var success = hw.interrupt_unwatch(interruptID, interruptModeForType(mode));

//       // If it went well
//       if (success) {

//         // Call callback with no error
//         if (callback) {
//           callback();
//         }

//         return 1;
//       } 
//       // If it didn't
//       else {

//         // Throw the error
//         if (callback) {
//           callback(new Error("Unable to cancel interrupt..."));
//         }

//         return -1;
//       }
//     }
//   }
//   else {
//     if (callback) {
//       callback();
//     }
//     return 1;
//   }
// };


/**
 * Button
 */

function Button(pin){
  this.pin = pin;
}

Button.prototype = new EventEmitter();

Button.prototype.record = function(){
  var inter = hw.interrupt_available();
  hw.interrupt_record(inter, this.pin);

  var l = this;
  var lastfall = 0, lastrise = 0;
  setInterval(function () {
    var rise = hw.interrupt_record_lastrise(inter), 
       fall = hw.interrupt_record_lastfall(inter);
    if (rise != lastrise) {
      l.emit('rise', rise, fall);
    }
    lastrise = rise;
    if (fall != lastfall) {
      l.emit('fall', rise, fall); 
    }
    lastfall = fall;
  }, 1);
  return l;
};

/**
 * Board
 */

//
// I2C
//

var i2c0initialized = false;
var i2c1initialized = false;

var I2CMode = {
  Master : hw.I2C_MASTER,
  Slave: hw.I2C_SLAVE,
  General: hw.I2C_GENERAL
};

function I2C (addr, mode, port) {
  this.addr = addr;
  this.i2c_port = port;
  if (mode == hw.I2C_SLAVE){
    this.mode = hw.I2C_SLAVE;
  } else {
    this.mode = hw.I2C_MASTER;
  }
}

I2C.prototype._initialize = function () {
  // if you give an address, we assume it'll be a slave
  if (!i2c0initialized && this.i2c_port == hw.I2C_0 ){
    hw.i2c_initialize(hw.I2C_0);
    hw.i2c_enable(hw.I2C_0, this.mode);
    i2c0initialized = true;
  } else if (!i2c1initialized && this.i2c_port == hw.I2C_1 ){
    hw.i2c_initialize(hw.I2C_1);
    hw.i2c_enable(hw.I2C_1, this.mode);
    i2c1initialized = true;
  }

  if (this.mode == hw.I2C_SLAVE){
    hw.i2c_set_slave_addr(this.i2c_port, this.addr);
  }
};

I2C.prototype.disable = function() {

  if (i2c0initialized && this.i2c_port == hw.I2C_0 ){
    hw.i2c_disable(hw.I2C_0);
    i2c0initialized = false;
  } else if (i2c1initialized && this.i2c_port == hw.I2C_1 ){
    hw.i2c_disable(hw.I2C_1);
    i2c1initialized = false;
  }
};

// DEPRECATED old way of invoking I2C initialization
I2C.prototype.initialize = function () { };

// DEPRECATED
I2C.prototype.transferSync = function (data, rxbuf_len) {
  throw new Error('I2C#transferSync is removed. Please use I2C#transfer.');
};

// DEPRECATED
I2C.prototype.sendSync = function (data) {
  throw new Error('I2C#sendSync is removed. Please use I2C#send.');
};

// DEPRECATED
I2C.prototype.receiveSync = function (buf_len) {
  throw new Error('I2C#receiveSync is removed. Please use I2C#receive.');
};


I2C.prototype.transfer = function (txbuf, rxbuf_len, unused_rxbuf, callback)
{
  if (!callback) {
    callback = unused_rxbuf;
    unused_rxbuf = null;
  }

  var self = this;
  setImmediate(function() {
    self._initialize();
    if (self.mode == hw.I2C_SLAVE) {
      var ret = hw.i2c_slave_transfer(self.i2c_port, txbuf, rxbuf_len);
    } else {
      var ret = hw.i2c_master_transfer(self.i2c_port, self.addr, txbuf, rxbuf_len);
    }
    var err = ret[0], rxbuf = ret[1];
    callback && callback(err, rxbuf);
  });
};


I2C.prototype.send = function (txbuf, callback)
{
  var self = this;
  setImmediate(function() {
    self._initialize();
    if (self.mode == hw.I2C_SLAVE) {
      var err = hw.i2c_slave_send(self.i2c_port, txbuf);
    } else {
      var err = hw.i2c_master_send(self.i2c_port, self.addr, txbuf);
    }
    callback && callback(err);
  });
};


I2C.prototype.receive = function (rxbuf_len, unused_rxbuf, callback)
{
  if (!callback) {
    callback = unused_rxbuf;
    unused_rxbuf = null;
  }

  var self = this;
  setImmediate(function() {
    self._initialize();
    if (self.mode == hw.I2C_SLAVE) {
      var ret = hw.i2c_slave_receive(self.i2c_port, '', rxbuf_len);
    } else {
      var ret = hw.i2c_master_receive(self.i2c_port, self.addr, rxbuf_len);
    }
    var err = ret[0], rxbuf = ret[1];
    callback && callback(err, rxbuf);
  });
};

/**
 * UART
 */

var UARTParity = {
  None : hw.UART_PARITY_NONE,
  Odd : hw.UART_PARITY_ODD,
  Even : hw.UART_PARITY_EVEN,
  OneStick : hw.UART_PARITY_ONE_STICK,
  ZeroStick : hw.UART_PARITY_ZERO_STICK,
};

var UARTDataBits = {
  Five : hw.UART_DATABIT_5,
  Six : hw.UART_DATABIT_6,
  Seven : hw.UART_DATABIT_7,
  Eight : hw.UART_DATABIT_8,
};

var UARTStopBits = {
  One : hw.UART_STOPBIT_1,
  Two : hw.UART_STOPBIT_2,
};

function UART(params, port) {

  // Call Stream constructor
  this.readable = true;
  this.writable = true;

  if (!params) params = {};

  this.uartPort = port;

  // Default baudrate is 9600
  this.baudrate = (params.baudrate ? params.baudrate : 9600);

  // Default databits is eight
  this.dataBits = propertySetWithDefault(params.dataBits, UARTDataBits, UARTDataBits.Eight);

  // Default parity is none
  this.parity = propertySetWithDefault(params.parity, UARTParity, UARTParity.None);

  // Default stopbits is one
  this.stopBits = propertySetWithDefault(params.stopBits, UARTStopBits, UARTStopBits.One);

  // Initialize the port
  this.initialize();

  // When we get UART data
  process.on('uart-receive', function (port, data) {
    // If it's on this port
    if (port === this.uartPort) {
      // Emit the data
      this.emit('data', data);
    }
  }.bind(this));
}

util.inherits(UART, EventEmitter);
                                                  

UART.prototype.initialize = function(){
  hw.uart_initialize(this.uartPort, this.baudrate, this.dataBits, this.parity, this.stopBits);
};

UART.prototype.enable = function(){
  hw.uart_enable(this.uartPort);
};

UART.prototype.disable = function(){
  hw.uart_disable(this.uartPort);
};

UART.prototype.setBaudrate = function(baudrate){
  if (baudrate) {
    this.baudrate = baudrate;
    this.initialize();
    // hw.uart_initialize(this.uartPort, baudrate, this.dataBits, this.parity, this.stopBits); 
  } else {
    return this.baudrate;
  }
};

UART.prototype.write = function (txbuf) {
  // Send it off
  return hw.uart_send(this.uartPort, txbuf);
};

UART.prototype.checkReceiveFlag = function() {

  // Check if we've received anything on an interrupt
  while (hw.uart_check_receive_flag(this.uartPort)) {
    // Grab the latest from the UART ring buffer
    var data = hw.uart_receive(this.uartPort, 2048);

    if (data && data.length) {
      this.emit("data", data);
    }
  } 
};

UART.prototype.setDataBits = function(dataBits) {
  if (verifyParams(UARTDataBits, dataBits)) {
    this.dataBits = dataBits;
    this.initialize();
    return 1;
  }

  throw new Error("Invalid databits value");
};

UART.prototype.setParity = function(parity) {
  if (verifyParams(UARTParity, parity)) {
    this.parity = parity;
    this.initialize();
    return 1;
  }

  throw new Error("Invalid parity value");
};

UART.prototype.setStopBits = function(stopBits){
  if (verifyParams(UARTStopBits, stopBits)) {
    this.stopBits = stopBits;
    this.initialize();
    return 1;
  }

  throw new Error("Invalid stopbit value");
};


/**
 * SPI
 */

// Queue of pending transfers and locks
var _asyncSPIQueue = new AsyncSPIQueue();
// Simple ID generator for locks
var _masterLockGen = 0;

function AsyncSPIQueue() {
  if (!_asyncSPIQueue) {
    _asyncSPIQueue = this;
  }
  else {
    return _asyncSPIQueue;
  }

  // an array of pending transfers
  this.transfers = [];

  // an array of currently active and pending locks
  // Only the zeroeth element has a lock on the SPI Bus
  this.locks = [];
}

function SPILock(port) 
{
  this.id = ++_masterLockGen;
  this.port = port;
}

util.inherits(SPILock, EventEmitter);

SPILock.prototype.release = function(callback) 
{
  _asyncSPIQueue._deregisterLock(this, callback);
};

SPILock.prototype._rawTransaction = function(txbuf, rxbuf, callback) {

  function rawComplete(errBool) {
    // If a callback was requested
    if (callback) {
      // If there was an error
      if (errBool === 1) {
        // Create an error object
        err = new Error("Unable to complete SPI Transfer.");
      }
      // Call the callback
      callback(err, rxbuf);
    }
  }

  // When the transfer is complete, process it and call callback
  process.once('spi_async_complete', rawComplete);

  // Begin the transfer
  var ret = hw.spi_transfer(this.port, txbuf.length, rxbuf ? rxbuf.length : 0, txbuf, rxbuf);

  if (ret < 0) {
    process.removeListener('spi_async_complete', rawComplete);

    if (callback) {
      callback(new Error("Previous SPI transfer is in the middle of sending."));
    }
  }
};

SPILock.prototype.rawTransfer = function(txbuf, callback) {
   // Create a new receive buffer
  var rxbuf = new Buffer(txbuf.length);
  // Fill it with 0 to avoid any confusion
  rxbuf.fill(0);

  this._rawTransaction(txbuf, rxbuf, callback);
};

SPILock.prototype.rawSend = function(txbuf, callback) {
  // Push the transfer into the queue. Don't bother receiving any bytes
  // Returns a -1 on error and 0 on successful queueing
  // Set the raw property to true
  this._rawTransaction(txbuf, null, callback);
};

SPILock.prototype.rawReceive = function(buf_len, callback) {
  // We have to transfer bytes for DMA to tick the clock
  // Returns a -1 on error and 0 on successful queueing
  var txbuf = new Buffer(buf_len);
  txbuf.fill(0);

  this.rawTransfer(txbuf, callback);
};

_asyncSPIQueue._deregisterLock = function(lock, callback) {
  var self = this;

  // Remove this lock from the queue
  self.locks.shift();

  // Set immediate to ready the next lock
  if (self.locks.length) {
    setImmediate(function() {
      self.locks[0].emit('ready');
    });
  }
  // Or if we have remaining unlocked transfers to take care of
  else if (self.transfers.length > 0) {
    // Process the next one
    self._execute_async();
  }

  // Call the callback
  if (callback) {
    callback();
  }
};

_asyncSPIQueue._registerLock = function(lock) {
  // If there are no locks in the queue yet
  // And no pending transfers
  if (!this.locks.length && !this.transfers.length) {
    // Let the callback know we're ready
    setImmediate(function() {
      lock.emit('ready');
    });
  }

  // Add the lock to the lock queue
  this.locks.push(lock);
};

_asyncSPIQueue.acquireLock = function(port, callback)
{
  // Create a lock
  var lock = new SPILock(port);

  // Wait for an event that tells us to go
  if (callback) lock.once('ready', callback.bind(lock, null, lock));

  // Add it to our array of locks
  _asyncSPIQueue._registerLock(lock);
};

_asyncSPIQueue._pushTransfer = function(transfer) {

  // Push the transfer into the correct queue
  this.transfers.push(transfer);

  // If it's the only thing in the queue and there are no locks
  if (!this.locks.length && this.transfers.length === 1) {
    // Start executing
    return this._execute_async();
  }

  return 0;
};

_asyncSPIQueue._execute_async = function() {
  // Grab the transfer at the head of the queue
  // But don't shift until after it's processed
  var transfer = this.transfers[0];
  var err;
  var self = this;

  function processTransferCB(errBool) {

    // Get the recently completed transfer
    var completed = self.transfers.shift();

    // De-assert chip select
    transfer.port._activeChipSelect(0);

    // If this was a pending transfer that completed
    // just after we added one or more locks
    if (!completed.raw && self.locks.length) {
      // Tell it that after we complete here
      // The first lock has control of the SPI bus
      setImmediate(function() {
        self.locks[0].emit('ready');
      });
    }
    // If we have more transfers 
    else if (self.transfers.length) {
      // Continue processing transfers after calling callback
      setImmediate(self._execute_async.bind(self));
    }

    // If a callback was requested
    if (transfer.callback) {
      // If there was an error
      if (errBool === 1) {
        // Create an error object
        err = new Error("Unable to complete SPI Transfer.");
      }
      // Call the callback
      transfer.callback(err, transfer.rxbuf);
    }
  }

  // If it doesn't exist, something went wrong
  if (!transfer) {
    return -1;
  }
  else {

    // Switch SPI to these settings
    transfer.port._initialize();

    // Activate chip select if it was provided
    transfer.port._activeChipSelect(1);

    // When the transfer is complete, process it and call callback
    process.once('spi_async_complete', processTransferCB);

    // Begin the transfer
    return hw.spi_transfer(transfer.port, transfer.txbuf.length, transfer.rxbuf ? transfer.rxbuf.length : 0, transfer.txbuf, transfer.rxbuf);
  }
};

function AsyncSPITransfer(port, txbuf, rxbuf, callback, raw) {
  this.port = port;
  this.txbuf = txbuf;
  this.rxbuf = rxbuf;
  this.callback = callback;
  this.raw = raw;
}

// SPI parameters may be changed by different invocations,
// cache which SPI was used most recently to update parameters
// only when necessary.
var _currentSPI = null;

function SPI (params)
{ 
  params = params || {};

  // Eventually get correct port for hardware
  this.port = hw.SPI_0;

  // accept dataMode or cpol/cpha
  if (typeof params.dataMode == 'number') {
    params.cpol = params.dataMode & 0x1;
    params.cpha = params.dataMode & 0x2;
  }
  this.cpol = params.cpol == 'high' || params.cpol == 1 ? 1 : 0;
  this.cpha = params.cpha == 'second' || params.cpha == 1 ? 1 : 0;

  // Speed of the clock
  this.clockSpeed = params.clockSpeed || 100000;

  // Frame Mode (by vendor)
  // TODO add other frame modes here ('ti', 'microwire')
  this.frameMode = 'normal';

  // Slave vs. Master
  this.role = params.role == 'slave' ? 'slave': 'master';

  // MSB vs LSB Needs testing
  this.bitOrder = propertySetWithDefault(params.bitOrder, SPIBitOrder, SPIBitOrder.MSB);

  // chip Select is user wants us to toggle it for them
  this.chipSelect = params.chipSelect || null;

  this.chipSelectActive = params.chipSelectActive == 'high' || params.chipSelectActive == 1 ? 1 : 0;

  if (this.chipSelect) {
    this.chipSelect.output();
    if (this.chipSelectActive) {
      this.chipSelect.low();
    } else {
      this.chipSelect.high();
    }
  }

  // initialize here to pull sck, mosi, miso pins to default state
  this._initialize();
  
  // Confirmation that CS has been pulled high.
  var self = this;
  setImmediate(function () {
    self.emit('ready');
  });
}


util.inherits(SPI, EventEmitter);


SPI.prototype._activeChipSelect = function (flag)
{
  if (this.chipSelect) {
    if (this.chipSelectActive) {
      if (flag) {
        this.chipSelect.high();
      }
      else {
        this.chipSelect.low();
      }
    } else {
      if (flag) {
        this.chipSelect.low();
      }
      else {
        this.chipSelect.high();
      }
    }
  }
};

SPI.prototype._initialize = function ()
{
  if (_currentSPI != this) {
    hw.spi_initialize(this.port,
      Number(this.clockSpeed),
      this.role == 'slave' ? SPIMode.Slave : SPIMode.Master,
      this.cpol ? 1 : 0,
      this.cpha ? 1 : 0,
      this.frameMode == 'normal' ? SPIFrameMode.Normal : SPIFrameMode.Normal);
  }
};

// DEPRECATED this was the old way to invoke I2C initialize
SPI.prototype.initialize = function () { };


SPI.prototype.close = SPI.prototype.end = function ()
{
  hw.spi_disable(this.port);
};

SPI.prototype.transfer = function (txbuf, callback)
{
  // Create a new receive buffer
  var rxbuf = new Buffer(txbuf.length);
  // Fill it with 0 to avoid any confusion
  rxbuf.fill(0);

  // Push it into the queue to be completed
  // Returns a -1 on error and 0 on successful queueing
  return _asyncSPIQueue._pushTransfer(new AsyncSPITransfer(this, txbuf, rxbuf, callback, false));
};

SPI.prototype.send = function (txbuf, callback)
{
  // Push the transfer into the queue. Don't bother receiving any bytes
  // Returns a -1 on error and 0 on successful queueing
  return _asyncSPIQueue._pushTransfer(new AsyncSPITransfer(this, txbuf, null, callback, false));
};


SPI.prototype.receive = function (buf_len, callback)
{
  // We have to transfer bytes for DMA to tick the clock
  // Returns a -1 on error and 0 on successful queueing
  var txbuf = new Buffer(buf_len);
  txbuf.fill(0);
  
  this.transfer(txbuf, callback);
};


SPI.prototype.setBitOrder = function (bitOrder)
{
  this.bitOrder = bitOrder;
};


SPI.prototype.setClockSpeed = function(clockSpeed) {
  if (clockSpeed > 0 && clockSpeed < 20e6) {
    this.clockSpeed = clockSpeed;
  } else {
    throw new Error("Invalid clockspeed value");
  }
};


SPI.prototype.setDataMode = function (dataMode)
{
  this.cpol = dataMode & 0x1;
  this.cpha = dataMode & 0x2;
};


SPI.prototype.setFrameMode = function (frameMode)
{
  this.frameMode = frameMode;
};


SPI.prototype.setRole = function (role)
{
  this.role = role;
};


SPI.prototype.setChipSelectMode = function (chipSelectMode)
{
  this.chipSelectMode = chipSelectMode;
  this.activeChipSelect(0);
};

SPI.prototype.lock = function(callback)
{
  // acquire a lock and return it
  _asyncSPIQueue.acquireLock(this, callback);
};


var SPIBitOrder = {
  MSB : 0,
  LSB : 1,
};

/* 
*   MODE         CPOL   CPHA
*   SPI_MODE0      0     0
*   SPI_MODE1      0     1
*   SPI_MODE2      1     0
*   SPI_MODE3      1     1 
*/
var SPIDataMode = {
  Mode0 : hw.SPI_MODE_0, // should be mode 2
  Mode1 : hw.SPI_MODE_1, 
  Mode2 : hw.SPI_MODE_2, // should be mode 0
  Mode3 : hw.SPI_MODE_3,
};

var SPIMode = {
  Slave : hw.SPI_SLAVE_MODE,
  Master : hw.SPI_MASTER_MODE,
};

var SPIFrameMode = {
  Normal : hw.SPI_NORMAL_FRAME,
  TI : hw.SPI_TI_FRAME,
  MicroWire : hw.SPI_MICROWIRE_FRAME,
};

var SPIChipSelectMode = {
  ActiveHigh : 0,
  ActiveLow : 1,
};


/**
 * Ports
 */

function Port (id, digital, analog, i2c, uart)
{
  this.id = String(id);
  var self = this;
  this.digital = digital.slice();
  this.analog = analog.slice();
  this.pin = {};
  var pinMap = null;
  if (id.toUpperCase() == 'GPIO') {
    
    pinMap = { 'G1': 0, 'G2': 1, 'G3': 2, 'G4': 3, 'G5': 4
      , 'G6': 5, 'A1': 0, 'A2': 1, 'A3': 2, 'A4': 3, 'A5': 4, 'A6': 5 };

  } else {
    pinMap = {'G1': 0, 'G2': 1, 'G3': 2};
  }
  
  Object.keys(pinMap).forEach(function(pinKey){

    self.pin[pinKey] = self.digital[pinMap[pinKey]];

    Object.defineProperty(self.pin, pinKey.toLowerCase(), {
      get: function () { return self.pin[pinKey] } 
    });
  });

  this.I2C = function (addr, mode, port) {
    return new I2C(addr, mode, port === null ? i2c : port);
  };

  this.UART = function (format, port) {
    if (uart === null) {
      throw tessel_version > 1 ? 'Software UART not yet functional for this port. You must use module port A, B, or D.' : 'Board version only supports UART on GPIO port.';
    }
    return new UART(format, port === null ? uart : port);
  };
}


Port.prototype.SPI = function (format, port){
  return new SPI(format);
};

Port.prototype.pinOutput = function (n) {
  hw.digital_output(n);
};

Port.prototype.digitalWrite = function (n, val) {
  hw.digital_write(n, val ? hw.HIGH : hw.LOW);
};

function Tessel() {
  var self = this;

  if (Tessel.instance) {
    return Tessel.instance;
  }
  else {
    Tessel.instance = this;
  }
  
  this.led = [new Pin(hw.PIN_LED1), new Pin(hw.PIN_LED2), new Pin(hw.PIN_WIFI_ERR_LED), new Pin(hw.PIN_WIFI_CONN_LED)];
  
  this.pin = {
    'LED1': this.led[0],
    'LED2': this.led[1],
    'Error': this.led[2],
    'Conn': this.led[3]
  }

  this.interrupts = {};

  // allow for lowercase and uppercase usage of this.pins, ex: this.pin['error' | 'ERROR']
  Object.keys(this.pin).forEach(function(pinKey){
    Object.defineProperty(self.pin, pinKey.toLowerCase(), {
      get: function () { return self.pin[pinKey] } 
    });

    if (pinKey.toUpperCase() != pinKey) {
      Object.defineProperty(self.pin, pinKey.toUpperCase(), {
        get: function () { return self.pin[pinKey] } 
      });
    }
  });

  this.ports =  {
    A: new Port('A', [new Pin(hw.PIN_A_G1), new Pin(hw.PIN_A_G2), new Pin(hw.PIN_A_G3)], [],
      hw.I2C_1,
      tessel_version > 1 ? hw.UART_3 : null
    ),
    B: new Port('B', [new Pin(hw.PIN_B_G1), new Pin(hw.PIN_B_G2), new Pin(hw.PIN_B_G3)], [],
      hw.I2C_1,
      tessel_version > 1 ? hw.UART_2 : null
    ),
    C: new Port('C', [new Pin(hw.PIN_C_G1), new Pin(hw.PIN_C_G2), new Pin(hw.PIN_C_G3)], [],
      tessel_version > 1 ? hw.I2C_0 : hw.I2C_1,
      // tessel_version > 1 ? hw.UART_SW_0 : null
      null
    ),
    D: new Port('D', [new Pin(hw.PIN_D_G1), new Pin(hw.PIN_D_G2), new Pin(hw.PIN_D_G3)], [],
      tessel_version > 1 ? hw.I2C_0 : hw.I2C_1,
      tessel_version > 1 ? hw.UART_0 : null
    ),
    GPIO: new Port('GPIO', [new Pin(hw.PIN_E_G1), new Pin(hw.PIN_E_G2), new Pin(hw.PIN_E_G3),
      new Pin(hw.PIN_E_G4), new Pin(hw.PIN_E_G5), new Pin(hw.PIN_E_G6)
    ], [new AnalogPin(hw.PIN_E_A1), new AnalogPin(hw.PIN_E_A2), new AnalogPin(hw.PIN_E_A3),
      new AnalogPin(hw.PIN_E_A4), new AnalogPin(hw.PIN_E_A5), new AnalogPin(hw.PIN_E_A6)
    ],
      hw.I2C_1,
      tessel_version > 1 ? null : hw.UART_2
    ),
  };

  this.button = new Pin(hw.BUTTON);

  this.port = function (label) {
    return board.ports[label.toUpperCase()];
  };

  this.sleep = function (n) {
    if (n < 1) {
      n = 1;
    }
    hw.sleep_ms(n);
  };

  this.deviceId = function(){
    return hw.device_id();
  }; 

}

util.inherits(Tessel, EventEmitter);

var board = module.exports = new Tessel();

// TM 2014-01-30 new API >>>
for (var key in board.ports) {
  board.port[key] = board.ports[key];
}

// sendfile
process.sendfile = function (filename, buf) {
  process.binding('hw').usb_send(0x4113, require('_structured_clone').serialize({
    filename: filename,
    buffer: buf
  }));
};


module.exports.I2CMode = I2CMode;
module.exports.SPIBitOrder = SPIBitOrder;
module.exports.SPIDataMode = SPIDataMode;
module.exports.SPIMode = SPIMode;
module.exports.SPIFrameMode = SPIFrameMode;
module.exports.SPIChipSelectMode = SPIChipSelectMode;
module.exports.UARTParity = UARTParity;
module.exports.UARTDataBits = UARTDataBits;
module.exports.UARTStopBits = UARTStopBits;