/**
 * @module WebCounter
 * @author Peter Širka
 */

const COOKIE = '__webcounter';
const REG_ROBOT = /search|agent|bot|crawler/i;
const REG_HOSTNAME = /(http|https)\:\/\/(www\.)/gi;
const TIMEOUT_VISITORS = 1200; // 20 MINUTES

function WebCounter() {
	this.stats = { pages: 0, day: 0, month: 0, year: 0, hits: 0, unique: 0, uniquemonth: 0, count: 0, search: 0, direct: 0, social: 0, unknown: 0, advert: 0, mobile: 0, desktop: 0, visitors: 0, robots: 0 };
	this.online = 0;
	this.arr = [0, 0];
	this.interval = 0;
	this.current = 0;
	this.last = 0;
	this.lastvisit = null;
	this.social = ['plus.url.google', 'plus.google', 'twitter', 'facebook', 'linkedin', 'tumblr', 'flickr', 'instagram', 'vkontakte', 'snapchat', 'skype', 'whatsapp', 'wechat'];
	this.search = ['google', 'bing', 'yahoo', 'duckduckgo', 'yandex'];
	this.ip = [];
	this.url = [];
	this.allowXHR = true;
	this.allowIP = false;
	this.onValid = null;

	this._onValid = function(req) {
		var self = this;
		var agent = req.headers['user-agent'];
		if (!agent || req.headers['x-moz'] === 'prefetch')
			return false;

		if (self.onValid && !self.onValid(req))
			return false;

		if (agent.match(REG_ROBOT)) {
			self.stats.robots++;
			return false;
		}

		return true;
	};

	this.isAdvert = function(req) {
		return (req.query['utm_medium'] || req.query['utm_source']) ? true : false;
	};

	var self = this;

	F.on('database', function() {
		self.load();
	});

	// every 45 seconds
	setInterval(this.clean.bind(this), 1000 * 45);
}

WebCounter.prototype = {

	get online() {
		var arr = this.arr;
		return arr[0] + arr[1];
	},

	get today() {
		var self = this;
		var stats = U.copy(self.stats);
		stats.last = self.lastvisit;
		stats.pages = stats.hits && stats.count ? (stats.hits / stats.count).floor(2) : 0;
		return stats;
	}
};

/**
 * Clean up
 * @return {Module]
 */
WebCounter.prototype.clean = function() {

	var self = this;

	self.interval++;

	if (self.interval % 2 === 0)
		self.save();

	var now = new Date();
	var stats = self.stats;

	self.current = now.getTime();

	var day = now.getDate();
	var month = now.getMonth() + 1;
	var year = now.getFullYear();
	var length = 0;

	if (stats.day !== day || stats.month !== month || stats.year !== year) {
		if (stats.day !== 0 || stats.month !== 0 || stats.year !== 0) {
			self.append();
			var visitors = stats.visitors;
			var keys = Object.keys(stats);
			length = keys.length;
			for (var i = 0; i < length; i++)
				stats[keys[i]] = 0;
			stats.visitors = visitors;
		}
		stats.day = day;
		stats.month = month;
		stats.year = year;
		self.save();
	}

	var arr = self.arr;

	var tmp1 = arr[1];
	var tmp0 = arr[0];

	arr[1] = 0;
	arr[0] = tmp1;

	if (tmp0 !== arr[0] || tmp1 !== arr[1]) {
		var online = arr[0] + arr[1];
		if (online != self.last) {
			if (self.allowIP)
				self.ip = self.ip.slice(tmp0);
			self.last = online;
		}
	}

	return self;
};

/**
 * Custom counter
 * @return {Module]
 */
WebCounter.prototype.increment = function(type) {

	var self = this;

	if (self.stats[type] === undefined)
		self.stats[type] = 1;
	else
		self.stats[type]++;

	return self;
};

/**
 * Request counter
 * @return {Module]
 */
WebCounter.prototype.counter = function(req, res) {

	var self = this;
	if (!self._onValid(req) || req.method !== 'GET' || (req.xhr && !self.allowXHR) || !req.headers['accept'] || !req.headers['accept-language'])
		return false;

	var arr = self.arr;
	var user = req.cookie(COOKIE).parseInt();
	var now = new Date();
	var ticks = now.getTime();
	var sum = user ? (ticks - user) / 1000 : 1000;
	var exists = sum < 91;
	var stats = self.stats;
	var referer = req.headers['x-referer'] || req.headers['referer'];
	var ping = req.headers['x-ping'];

	if (user)
		sum = Math.abs(self.current - user) / 1000;

	var isHits = user ? sum >= TIMEOUT_VISITORS : true;

	if (!ping || isHits) {
		stats.hits++;
		self.refreshURL(referer, req);
	}

	if (exists)
		return true;

	var isUnique = false;

	if (user) {

		sum = Math.abs(self.current - user) / 1000;

		// 20 minutes
		if (sum < TIMEOUT_VISITORS) {
			arr[1]++;
			self.lastvisit = new Date();
			res.cookie(COOKIE, ticks, now.add('5 days'));
			return true;
		}

		var date = new Date(user);
		if (date.getDate() !== now.getDate() || date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear())
			isUnique = true;

		if (date.diff('months') < 0)
			stats.uniquemonth++;

	} else {
		isUnique = true;
		stats.uniquemonth++;
	}

	if (isUnique) {
		stats.unique++;
		if (req.mobile)
			stats.mobile++;
		else
			stats.desktop++;
	}

	arr[1]++;
	self.lastvisit = new Date();
	res.cookie(COOKIE, ticks, now.add('5 days'));

	if (self.allowIP)
		self.ip.push({ ip: req.ip, url: req.uri.href });

	var online = self.online;

	if (self.last !== online)
		self.last = online;

	stats.count++;
	stats.visitors++;

	if (self.isAdvert(req)) {
		stats.advert++;
		return true;
	}

	referer = getReferrer(referer);

	if (!referer || (webcounter.hostname && referer.indexOf(webcounter.hostname) !== -1)) {
		stats.direct++;
		return true;
	}

	for (var i = 0, length = self.social.length; i < length; i++) {
		if (referer.indexOf(self.social[i]) !== -1) {
			stats.social++;
			return true;
		}
	}

	for (var i = 0, length = self.search.length; i < length; i++) {
		if (referer.indexOf(self.search[i]) !== -1) {
			stats.search++;
			return true;
		}
	}

	stats.unknown++;
	return true;
};

/**
 * Saves the current stats into the cache
 * @return {Module]
 */
WebCounter.prototype.save = function() {
	var self = this;
	var id = (F.id === null ? '0' : F.id.toString()) + '-cache';
	self.stats.pages = self.stats.hits && self.stats.count ? (self.stats.hits / self.stats.count).floor(2) : 0;

	var nosql = DB();

	nosql.update('update', 'stats').make(function(builder) {
		builder.set(self.stats);
		builder.where('_id', id);
		builder.first();
	});

	nosql.ifnot('update', function() {
		nosql.insert('stats').make(function(builder) {
			builder.replace(nosql.builder('update'), true);
			builder.set('_id', id);
		});
	});

	nosql.exec(function(err) {
		if (err)
			F.error(err);
		delete self.stats.pages;
	});

	return self;
};

/**
 * Loads stats from the cache
 * @return {Module]
 */
WebCounter.prototype.load = function() {
	var self = this;
	var id = (F.id === null ? '0' : F.id.toString()) + '-cache';

	var nosql = DB();

	nosql.select('stats', 'stats').make(function(builder) {
		builder.where('_id', id);
		builder.first();
	});

	nosql.exec(function(err, response) {
		if (err)
			F.error(err);
		if (response.stats)
			self.stats = response.stats;
	});

	return self;
};

/**
 * Creates a report from previous day
 * @return {Module]
 */
WebCounter.prototype.append = function() {
	var self = this;
	var id = (self.stats.year + '' + self.stats.month.padLeft(2) + '' + self.stats.day.padLeft(2)).parseInt();
	var nosql = DB();

	nosql.update('update', 'stats').make(function(builder) {
		builder.inc(self.stats);
		builder.where('_id', id);
		builder.first();
	});

	nosql.ifnot('update', function(error, response) {
		nosql.insert('stats').make(function(builder) {
			builder.replace(nosql.builder('update'), true);
			builder.set('_id', id);
		});
	});

	nosql.exec(F.error());
	return self;
};

/**
 * Dail stats
 * @param {Function(stats)} callback
 * @return {Module]
 */
WebCounter.prototype.daily = function(callback) {
	var self = this;
	self.statistics(callback);
	return self;
};

/**
 * Monthly stats
 * @param {Function(stats)} callback
 * @return {Module]
 */
WebCounter.prototype.monthly = function(callback) {
	var self = this;
	self.statistics(function(arr) {

		if (!arr.length)
			return callback(EMPTYOBJECT);

		var stats = {};
		for (var i = 0, length = arr.length; i < length; i++) {
			var current = arr[i];
			var key = current.month + '-' + current.year;
			if (stats[key])
				sum(stats[key], current);
			else
				stats[key] = current;
		}
		callback(stats);
	});
	return self;
};

/**
 * Yearly stats
 * @param {Function(stats)} callback
 * @return {Module]
 */
WebCounter.prototype.yearly = function(callback) {
	var self = this;
	self.statistics(function(arr) {

		if (!arr.length)
			return callback(EMPTYOBJECT);

		var stats = {};
		for (var i = 0, length = arr.length; i < length; i++) {
			var current = arr[i];
			var key = current.year.toString();
			if (stats[key])
				sum(stats[key], current);
			else
				stats[key] = current;
		}

		callback(stats);
	});
	return self;
};

/**
 * Read stats from DB
 * @param {Function(stats)} callback
 * @return {Module]
 */
WebCounter.prototype.statistics = function(callback) {
	var self = this;
	var nosql = DB();

	nosql.select('stats').make((builder) => builder.where('_id', '>', 0));
	nosql.exec(function(err, response) {
		if (err)
			F.error(err);
		callback(response[0]);
	});

	return self;
};

/**
 * Refresh visitors URL
 * @internal
 * @param {String} referer
 * @param {Request} req
 */
WebCounter.prototype.refreshURL = function(referer, req) {

	if (!referer)
		return;

	var self = this;

	if (!self.allowIP)
		return;

	for (var i = 0, length = self.ip.length; i < length; i++) {
		var item = self.ip[i];
		if (item.ip === req.ip && item.url === referer) {
			item.url = req.headers['x-ping'] || req.uri.href;
			return;
		}
	}
};

function sum(a, b) {
	Object.keys(b).forEach(function(o) {
		if (o === 'day' || o === 'year' || o === 'month')
			return;

		if (o === 'visitors') {
			a[o] = Math.max(a[o] || 0, b[o] || 0);
			return;
		}

		if (a[o] === undefined)
			a[o] = 0;
		if (b[o] !== undefined)
			a[o] += b[o];
	});
}

function getReferrer(host) {
	if (!host)
		return null;
	var index = host.indexOf('/') + 2;
	return host.substring(index, host.indexOf('/', index)).toLowerCase();
}

// Instance
var webcounter = new WebCounter()

var delegate_request = function(controller, name) {
	webcounter.counter(controller.req, controller.res);
	module.exports.instance = webcounter;
};

module.exports.name = 'webcounter';
module.exports.version = 'v3.1.0';
module.exports.instance = webcounter;

F.on('controller', delegate_request);

function refresh_hostname() {
	var url;
	if (F.config.custom)
		url = F.config.custom.url;
	if (!url)
		url = F.config.url || F.config.hostname;
	if (!url)
		return;
	url = url.toString().replace(REG_HOSTNAME, '');
	var index = url.indexOf('/');
	if (index !== -1)
		url = url.substring(0, index);
	webcounter.hostname = url.toLowerCase();
}

module.exports.install = function() {
	setTimeout(refresh_hostname, 10000);
	F.on('service', function(counter) {
		if (counter % 120 === 0)
			refresh_hostname();
	});
};

module.exports.usage = function() {
	var stats = U.extend({}, webcounter.stats);
	stats.online = webcounter.online;
	return stats;
};

module.exports.online = function() {
	return webcounter.online;
};

module.exports.today = function() {
	return webcounter.today;
};

module.exports.increment = module.exports.inc = function(type) {
	webcounter.increment(type);
	return this;
};

module.exports.monthly = function(callback) {
	return webcounter.monthly(callback);
};

module.exports.yearly = function(callback) {
	return webcounter.yearly(callback);
};

module.exports.daily = function(callback) {
	return webcounter.daily(callback);
};