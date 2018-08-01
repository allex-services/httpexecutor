var Url = require('url');

function createHttpExecutorService(execlib, ParentService) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    qlib = lib.qlib,
    execSuite = execlib.execSuite;

  function factoryCreator(parentFactory) {
    return {
      'service': require('./users/serviceusercreator')(execlib, parentFactory.get('service')),
      'user': require('./users/usercreator')(execlib, parentFactory.get('user')) 
    };
  }

  function HttpExecutorService(prophash) {
    ParentService.call(this, prophash);
    this.strategynames = prophash.strategies ? Object.keys(prophash.strategies) : [];
    this.guardedMethods = prophash.guardedMethods || {};
    this.allowAnonymous = prophash.allowAnonymous;
    this.authenticator = null;
    execSuite.acquireAuthSink(prophash.strategies).done(
      this.onAuthenticator.bind(this),
      this.close.bind(this)
    );
  }
  
  ParentService.inherit(HttpExecutorService, factoryCreator);
  
  HttpExecutorService.prototype.__cleanUp = function() {
    if(this.authenticator){
      this.authenticator.destroy();
    }
    this.authenticator = null;
    this.allowAnonymous = null;
    this.guardedMethods = null;
    this.strategynames = null;
    ParentService.prototype.__cleanUp.call(this);
  };
  
  HttpExecutorService.prototype.onAuthenticator = function (authsink) {
    if(!this.destroyed){
      authsink.destroy();
      return;
    }
    this.authenticator = authsink;
    if (!this.authenticator) {
      console.error('no authsink');
      process.exit(0);
    }
  };

  HttpExecutorService.prototype.extractRequestParams = function(url, req){
    if (url.alreadyprocessed) {
      return q(url.alreadyprocessed);
    }
    switch (req.method) {
      case 'GET':
        return q(url.query);
      case 'PUT':
      case 'POST':
        return this.readRequestBody(req);
      default:
        return q.reject(new lib.Error('UNSUPPORTED_REQUEST_METHOD', 'Request method `'+req.method+'` is not supported'));
    }
  };

  HttpExecutorService.prototype.authenticate = function(credentials){
    if(!this.strategynames){
      return q(null);
    }
    if(!this.authenticator){
      console.trace();
      console.error('How come EntryPointService has no authenticator?!');
      return q(null);
    }
    var resolveobj = {};
    this.strategynames.forEach(function(stratname){
      resolveobj[stratname] = credentials;
    });
    credentials = null;
    return this.authenticator.call('resolve',resolveobj);
  };

  HttpExecutorService.prototype.authenticateGuarded = function (methodname, req, res, reqparams) {
    var t = this, 
      authobj = {},
      invokeobj = {},
      processedurl = {alreadyprocessed: invokeobj},
      cleaner = function () {
        t = null;
        authobj = null;
        invokeobj = null;
        processedurl = null;
        methodname = null;
        req = null;
        res = null;
        reqparams = null;
        cleaner = null;
      },
      strategyname = this.guardedMethods[methodname],
      i,
      authprefix = '__'+strategyname+'__',
      mymethod = this[methodname];
    for (i in reqparams) {
      if (!(i in reqparams)) {
        continue;
      }
      if (i.indexOf(authprefix) === 0) {
        authobj[i.substr(authprefix.length)] = reqparams[i];
      } else {
        invokeobj[i] = reqparams[i];
      }
    }
    return this.authenticate(authobj).then(
      function (result) {
        if (!result) {
          res.end('{}');
        } else {
          processedurl.auth = result;
          mymethod.call(t, processedurl, req, res);
        }
        cleaner();
      },
      function (err) {
        req.end('{}');
        cleaner();
      }
    );
  };

  HttpExecutorService.prototype._onRequest = function(req,res){
    try {
    var url = Url.parse(req.url,true),
      query = url.query,
      mymethodname = url.pathname.substring(1),
      mymethod = this[mymethodname],
      isanonymous = this.anonymousMethods.indexOf(mymethodname)>=0,
      targetmethodlength = isanonymous ? 3 : 3;
    if (!mymethodname) {
      res.end(this.emptyMethodResponse || '{}');
      return;
    }
    //any mymethod has to accept (url,req,res),
    if(!lib.isFunction(mymethod)){
      res.end('{}');
      return;
    }
    if(mymethod.length!==targetmethodlength){
      res.end(mymethodname+' length '+mymethod.length+' is not '+targetmethodlength);
      return;
    }
    if (this.guardedMethods[mymethodname]) {
      this.extractRequestParams(url, req).then(
        this.authenticateGuarded.bind(this, mymethodname, req, res)
      );
      return;
    }
    if (isanonymous) {
      if (this.allowAnonymous) {
        mymethod.call(this, url, req, res);
      } else {
        res.end('');
      }
    } else {
      //mymethod.call(this, url, req, res);
      res.end('');
    }
    } catch(e) {
      console.error(e);
      res.writeHead(500, 'Internal error');
      res.end('Internal error');
    }
  };
  HttpExecutorService.prototype.readRequestBody = function (req) {
    var defer = q.defer();
    var body = '';
    function ender () {
      detacher();
      //console.log('request body', body);
      try {
        body = JSON.parse(body);
      } catch(ignore) {}
      defer.resolve(body);
      body = null;
      defer = null;
    }
    function errorer (err) {
      detacher();
      defer.reject(err);
      defer = null;
      body = null;
    }
    function dataer (chunk) {
      body += chunk.toString('utf8');
    }
    function detacher () {
      req.removeListener('end', ender);
      req.removeListener('error', errorer);
      req.removeListener('data', dataer);
    }
    req.on('end', ender);
    req.on('error', errorer);
    req.on('data', dataer);
    return defer.promise;
  };

  HttpExecutorService.prototype.resEnder = function (res, string) {
    return function () {
      res.end(string);
      res = null;
      string = null;
    }
  }

  HttpExecutorService.prototype.resJSONEnder = function (res, obj) {
    return this.resEnder(res, JSON.stringify(obj));
  }

  HttpExecutorService.prototype.anonymousMethods = [];

  return HttpExecutorService;
}

module.exports = createHttpExecutorService;
