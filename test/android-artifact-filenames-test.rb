require 'json'
require 'tmpdir'
require 'fileutils'

module UI
  def self.user_error!(message); raise message; end
  def self.message(_message); end
  def self.success(_message); end
end

module Fastlane
  module Actions
    class FirebaseAppDistributionAction; end
  end
end

class AndroidArtifactHarness
  attr_reader :uploads

  def require(name)
    return false if name == 'fastlane/plugin/firebase_app_distribution'
    super
  end

  def initialize(root)
    @root = root
    @lanes = {}
    @uploads = []
  end

  def platform(name)
    @platform = name
    yield
  end

  def lane(name, &block); @lanes[[@platform, name]] = block; end
  def before_all(&block); end
  def desc(_message); end
  def build(options); run(:build, **options); end
  def build_apk(options); run(:build_apk, **options); end
  def gradle(project_dir:, task:, build_type:)
    raise 'wrong build type' unless build_type == 'Release'
    kind = task == 'assemble' ? 'apk' : 'bundle'
    ext = task == 'assemble' ? 'apk' : 'aab'
    output = File.join(project_dir, 'app', 'build', 'outputs', kind, 'release', "app-release.#{ext}")
    FileUtils.mkdir_p(File.dirname(output))
    File.binwrite(output, "signed #{ext} for #{project_dir}")
  end

  def firebase_app_distribution(**options); @uploads << [:firebase, options]; end
  def upload_to_play_store(**options); @uploads << [:play, options]; end
  def run(name, **options); @lanes.fetch([:android, name]).call(options); end
end

Dir.mktmpdir do |root|
  harness = AndroidArtifactHarness.new(root)
  harness.instance_eval(File.read(ARGV.fetch(0)), ARGV.fetch(0))
  harness.define_singleton_method(:build_dir) { |slug| File.join(root, slug) }
  harness.define_singleton_method(:app_config) do |slug|
    versions = { 'poptale-global' => ['0.1.1', 7], 'characterchat-dev' => ['1.2.3', 44] }
    name, code = versions.fetch(slug)
    { 'appId' => "com.example.#{slug}", 'version' => { 'name' => name, 'code' => code } }
  end
  harness.define_singleton_method(:firebase_android_app_id) { |slug| "firebase:#{slug}" }
  credentials = File.join(root, 'credentials.json')
  File.write(credentials, '{}')
  ENV['FIREBASE_SERVICE_CREDENTIALS_FILE'] = credentials

  { 'poptale-global' => 'poptale-global-v0.1.1-7',
    'characterchat-dev' => 'characterchat-dev-v1.2.3-44' }.each do |slug, stem|
    harness.run(:build_apk, slug: slug)
    harness.run(:build, slug: slug)

    artifacts = File.join(root, slug, 'android', 'artifacts')
    { 'apk' => 'apk', 'aab' => 'bundle' }.each do |ext, kind|
      named = File.join(artifacts, "#{stem}.#{ext}")
      raw = File.join(root, slug, 'android', 'app', 'build', 'outputs', kind, 'release', "app-release.#{ext}")
      raise "missing #{named}" unless File.file?(named)
      raise "changed signed #{ext}" unless File.binread(named) == File.binread(raw)
      File.delete(named)
    end

    harness.run(:firebase, slug: slug, skip_build: true)
    harness.run(:beta, slug: slug, skip_build: true)
    raise 'skip_build did not restage APK' unless File.file?(File.join(artifacts, "#{stem}.apk"))
    raise 'skip_build did not restage AAB' unless File.file?(File.join(artifacts, "#{stem}.aab"))
    firebase = harness.uploads.find { |type, options| type == :firebase && options[:app] == "firebase:#{slug}" }[1]
    play = harness.uploads.find { |type, options| type == :play && options[:package_name] == "com.example.#{slug}" }[1]
    raise 'Firebase selected generic APK' unless firebase[:android_artifact_path] == File.join(artifacts, "#{stem}.apk")
    raise 'Play selected generic AAB' unless play[:aab] == File.join(artifacts, "#{stem}.aab")
  end

  puts 'PASS: app-specific signed APK/AAB files and upload paths'
end
