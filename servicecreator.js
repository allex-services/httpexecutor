var Url = require('url');

function createHttpExecutorService(execlib, ParentService) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    qlib = lib.qlib;

  function factoryCreator(parentFactory) {
    return {
      'service': require('./users/serviceusercreator')(execlib, parentFactory.get('service')),
      'user': require('./users/usercreator')(execlib, parentFactory.get('user')) 
    };
  }

  function HttpExecutorService(prophash) {
    ParentService.call(this, prophash);
  }
  
  ParentService.inherit(HttpExecutorService, factoryCreator);
  
  HttpExecutorService.prototype.__cleanUp = function() {
    ParentService.prototype.__cleanUp.call(this);
  };
  
  HttpExecutorService.prototype.extractRequestParams = function(url, req){
    if (req.method==='GET') {
      return q(url.query);
    }
    if (req.method==='PUT') {
      return this.readRequestBody(req);
    }
    return q.reject(new lib.Error('UNSUPPORTED_REQUEST_METHOD', 'Request method `'+req.method+'` is not supported'));
  };

  HttpExecutorService.prototype._onRequest = function(req,res){
    try {
    var url = Url.parse(req.url,true),
      query = url.query,
      mymethodname = url.pathname.substring(1),
      mymethod = this[mymethodname],
      isanonymous = this.anonymousMethods.indexOf(mymethodname)>=0,
      targetmethodlength = isanonymous ? 3 : 3;
    //any mymethod has to accept (url,req,res),
    if('function' !== typeof mymethod){
      res.end('');
      return;
    }
    if(mymethod.length!==targetmethodlength){
      res.end(mymethodname+' length '+mymethod.length+' is not '+targetmethodlength);
      return;
    }
    if (isanonymous) {
      if (this.allowAnonymous) {
        mymethod.call(this, url, req, res);
      } else {
        res.end('');
      }
    } else {
      mymethod.call(this, url, req, res);
    }
    } catch(e) {
      console.error(e.stack);
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
      console.log('request body', body);
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
      if (!body) {
        return;
      }
      body += chunk;
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
