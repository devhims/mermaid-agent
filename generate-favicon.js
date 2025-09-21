const { favicons } = require('favicons');
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'public', 'mermaid_logo.png');
const outputDir = path.join(__dirname, 'public');

console.log('Generating optimized favicon from:', source);

// Configuration optimized for Chrome and modern browsers
const configuration = {
  path: '/', // Path for overriding default icons path
  appName: 'Mermaid Viewer',
  appShortName: 'Mermaid',
  appDescription: 'AI-powered Mermaid diagram viewer and editor',
  developerName: null,
  developerURL: null,
  dir: 'auto',
  lang: 'en-US',
  background: false, // Preserve transparency
  theme_color: '#000000',
  appleStatusBarStyle: 'black-translucent',
  display: 'standalone',
  orientation: 'any',
  scope: '/',
  start_url: '/',
  preferRelatedApplications: false,
  relatedApplications: undefined,
  version: '1.0',
  pixel_art: false,
  loadManifestWithCredentials: false,
  manifestMaskable: false,
  icons: {
    // Focus on favicon generation with optimal sizes for Chrome
    android: false,
    appleIcon: false,
    appleStartup: false,
    coast: false,
    favicons: {
      // Generate specific sizes optimized for browsers
      offset: 0,
      background: false,
      mask: false,
      overlayGlow: false,
      overlayShadow: false,
    },
    firefox: false,
    windows: false, // Disable to avoid background requirement
    yandex: false,
  },
  output: {
    images: true,
    files: false, // Don't generate HTML/manifest files
    html: false,
    json: false,
  },
};

console.log('Starting optimized favicon generation for Chrome...');

favicons(source, configuration)
  .then(function (response) {
    console.log('✅ Favicon generation completed!');
    console.log(
      '📁 Generated files:',
      response.images.map((img) => img.name)
    );

    // Save the ICO file to the app directory
    const icoFile = response.images.find((img) => img.name === 'favicon.ico');
    if (icoFile) {
      const outputPath = path.join(__dirname, 'src', 'app', 'favicon.ico');
      fs.writeFileSync(outputPath, icoFile.contents);
      console.log('✅ favicon.ico saved to:', outputPath);
    }

    // Save individual PNG files for reference
    const pngFiles = response.images.filter((img) => img.name.endsWith('.png'));
    pngFiles.forEach((file) => {
      const outputPath = path.join(outputDir, file.name);
      fs.writeFileSync(outputPath, file.contents);
      console.log(`✅ ${file.name} saved to public folder`);
    });

    console.log('\n🎯 Optimized favicon sizes for Chrome:');
    console.log('   - 16×16: Browser tabs (primary)');
    console.log('   - 32×32: Bookmarks, taskbar');
    console.log('   - 48×48: High-DPI tabs');
    console.log('   - 64×64: Retina displays');
    console.log('   - 128×128: Very high-DPI');
    console.log('   - 256×256: Maximum quality');
  })
  .catch(function (error) {
    console.error('❌ Error generating favicons:', error);
  });
