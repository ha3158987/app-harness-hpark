require 'tmpdir'
require 'fileutils'

module UI
  def self.user_error!(message); raise message; end
  def self.message(_message); end
  def self.success(_message); end
end

class IOSArtifactHarness
  attr_reader :uploads

  def require(name)
    return false if name == 'fastlane/plugin/firebase_app_distribution'
    super
  end

  def initialize
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
  def match(**options); end
  def update_code_signing_settings(**options); end
  def ios_has_nse?(_build_path); false; end

  def build_app(**options)
    path = File.join(options.fetch(:output_directory), options.fetch(:output_name))
    FileUtils.mkdir_p(File.dirname(path))
    File.binwrite(path, 'signed TestFlight IPA')
  end

  def upload_to_testflight(**options); @uploads << options; end
  def build(options); run(:build, **options); end
  def run(name, **options); @lanes.fetch([:ios, name]).call(options); end
end

Dir.mktmpdir do |root|
  harness = IOSArtifactHarness.new
  harness.instance_eval(File.read(ARGV.fetch(0)), ARGV.fetch(0))
  harness.define_singleton_method(:build_dir) { |slug| File.join(root, slug) }
  harness.define_singleton_method(:app_config) do |slug|
    versions = { 'poptale-global' => ['0.1.1', 7], 'characterchat-dev' => ['1.0.0', 20] }
    name, code = versions.fetch(slug)
    { 'appId' => "com.example.#{slug}", 'version' => { 'name' => name, 'code' => code } }
  end
  harness.define_singleton_method(:ios_has_nse?) { |_build_path| false }

  { 'poptale-global' => 'poptale-global-v0.1.1-7.ipa',
    'characterchat-dev' => 'characterchat-dev-v1.0.0-20.ipa' }.each do |slug, filename|
    harness.run(:build, slug: slug)
    harness.run(:beta, slug: slug, skip_build: true)
    path = File.join(root, slug, 'ios', 'output', filename)
    raise "missing #{path}" unless File.binread(path) == 'signed TestFlight IPA'
    raise 'TestFlight selected a different IPA' unless harness.uploads.last[:ipa] == path
  end

  puts 'PASS: app-specific versioned iOS IPAs and TestFlight upload paths'
end
