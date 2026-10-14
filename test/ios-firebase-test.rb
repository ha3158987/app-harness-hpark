require 'json'
require 'tmpdir'
require 'fileutils'
module UI
 def self.user_error!(m);raise m;end
 def self.message(m);end
 def self.success(m);end
end
module Fastlane; module Actions; class FirebaseAppDistributionAction;end;end;end
class Harness
 attr_reader :calls
 def require(name); return false if name == 'fastlane/plugin/firebase_app_distribution'; super; end
 def initialize(root);@root=root;@lanes={};@calls=[];end
 def platform(x);@platform=x;yield;end
 def lane(name,&block);@lanes[[@platform,name]]=block;end
 def before_all(&b);end
 def desc(x);end
 def invoke;@lanes.fetch([:ios,:firebase]).call(slug:'fixture',skip_build:true,groups:'aipia_internal');end
 def get_info_plist_value(path:,key:);{'BUNDLE_ID'=>'com.example.fixture','GOOGLE_APP_ID'=>'1:123:ios:abc'}[key];end
 def get_ipa_info_plist_value(**o);'com.example.fixture';end
 def match(**o)
  @calls<<[:match,o]
  Array(o[:app_identifier]).each do |id|
   p=File.join(@root,id+'.mobileprovision');File.write(p,'profile')
   ENV["sigh_#{id}_adhoc_profile-path"]=p
   ENV["sigh_#{id}_adhoc_certificate-name"]='Apple Distribution: Test'
  end
 end
 def resign(**o);@calls<<[:resign,o];end
 def firebase_app_distribution(**o);@calls<<[:upload,o];end
end
Dir.mktmpdir do |root|
 h=Harness.new(root);h.instance_eval(File.read(ARGV.fetch(0)),ARGV.fetch(0))
 h.define_singleton_method(:build_dir){|_|root}
 h.define_singleton_method(:app_config){|_|{'appId'=>'com.example.fixture','version'=>{'name'=>'1.0.0','code'=>1}}}
 h.define_singleton_method(:ios_has_nse?){|_|true}
 FileUtils.mkdir_p(File.join(root,'ios','App'));FileUtils.mkdir_p(File.join(root,'ios','output'))
 File.write(File.join(root,'ios','App','GoogleService-Info.plist'),'fixture')
 source=File.join(root,'ios','output','fixture-v1.0.0-1.ipa');File.write(source,'original appstore IPA')
 creds=File.join(root,'credentials.json');File.write(creds,'{}');ENV['FIREBASE_SERVICE_CREDENTIALS_FILE']=creds
 h.invoke
 m=h.calls.find{|x|x[0]==:match}[1];raise 'wrong signing type' unless m[:type]=='adhoc' && m[:readonly]==true
 r=h.calls.find{|x|x[0]==:resign}[1];raise 'missing extension' unless r[:provisioning_profile].keys.sort==['com.example.fixture','com.example.fixture.NotificationService'].sort
 raise 'source overwritten' if r[:ipa]==source || File.read(source)!='original appstore IPA'
 raise 'unnamed Ad Hoc IPA' unless r[:ipa]==File.join(root,'ios','firebase-output','fixture-v1.0.0-1-adhoc.ipa')
 u=h.calls.find{|x|x[0]==:upload}[1];raise 'wrong destination' unless u[:app]=='1:123:ios:abc'&&u[:groups]=='aipia_internal'
 raise 'uploaded a different IPA' unless u[:ipa_path]==r[:ipa]
 h.define_singleton_method(:get_info_plist_value){|**o| o[:key]=='BUNDLE_ID' ? 'com.example.other' : '1:123:ios:abc'}
 before=h.calls.size
 begin;h.invoke;raise 'mismatch accepted';rescue=>e;raise e if e.message=='mismatch accepted';end
 raise 'side effect on mismatch' unless before==h.calls.size
 puts 'PASS: Ad Hoc profiles, extension, preserved TestFlight IPA, destination validation'
end
