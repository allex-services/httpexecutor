var Url = require('url');

function createHttpExecutorService(execlib, ParentService) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    qlib = lib.qlib,
    execSuite = execlib.execSuite;

  function endres (res) {
    res.end('{}');
  }

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
    //console.log('call', this.authenticator.modulename, this.authenticator.role, 'to resolve', credentials);
    return this.authenticator.call('resolve',credentials||{});
  };

  HttpExecutorService.prototype.authenticateGuarded = function (methodname, req, res, reqparams) {
    var authobj = {},
      alreadyprocobj = {},
      processedurl = {alreadyprocessed: alreadyprocobj},
      strategyname = this.guardedMethods[methodname],
      i,
      authprefix = '__'+strategyname+'__',
      mymethod = this[methodname],
      ret;
    if (!strategyname) {
      endres(res);
      return;
    }
    if (!lib.isFunction(mymethod)) {
      endres(res);
      return;
    }
    authobj[strategyname] = {};
    for (i in reqparams) {
      if (!(i in reqparams)) {
        continue;
      }
      if (i.indexOf(authprefix) === 0) {
        authobj[strategyname][i.substr(authprefix.length)] = reqparams[i];
      } else {
        alreadyprocobj[i] = reqparams[i];
      }
    }
    var ret = this.authenticate(authobj).then(
      onAuthGuardedAuthSucceeded.bind(null, this, mymethod, processedurl, req, res),
      onAuthGuardedAuthFailed.bind(null, res)
    );
    mymethod = null;
    processedurl = null;
    req = null;
    res = null;
    return ret;
  };

  function onAuthGuardedAuthSucceeded (httpex, mymethod, processedurl, req, res, result) {
    if (httpex && httpex.destroyed && result) {
      processedurl.auth = result;
      mymethod.call(httpex, processedurl, req, res);
    } else {
      endres(res);
    }
    httpex = null;
    mymethod = null;
    processedurl = null;
    req = null;
    res = null;
  }

  function onAuthGuardedAuthFailed (res, reason_ignored) {
    //console.log('authenticate error', err);
    res.end('{}');
    res = null;
  }

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
        endres(res);
        return;
      }
      if(mymethod.length!==targetmethodlength){
        console.log(mymethodname+' length '+mymethod.length+' is not '+targetmethodlength);
        endres(res);
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
