import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
  fputs("usage: swift scripts/generate_app_icon.swift <output.png>\n", stderr)
  exit(64)
}

let size = 1024
let bytesPerPixel = 4
let bytesPerRow = size * bytesPerPixel
let pixels = UnsafeMutablePointer<UInt8>.allocate(capacity: size * bytesPerRow)
defer { pixels.deallocate() }

guard
  let context = CGContext(
    data: pixels,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
  )
else {
  fatalError("Unable to create the icon drawing context")
}

let backgroundColors =
  [
    CGColor(red: 0.03, green: 0.55, blue: 0.91, alpha: 1),
    CGColor(red: 0.34, green: 0.31, blue: 0.84, alpha: 1),
    CGColor(red: 0.64, green: 0.47, blue: 0.98, alpha: 1),
  ] as CFArray
let locations: [CGFloat] = [0, 0.52, 1]
let gradient = CGGradient(
  colorsSpace: CGColorSpaceCreateDeviceRGB(),
  colors: backgroundColors,
  locations: locations
)!

context.drawLinearGradient(
  gradient,
  start: CGPoint(x: 96, y: 920),
  end: CGPoint(x: 928, y: 104),
  options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
)

context.setShadow(
  offset: CGSize(width: 0, height: -18), blur: 28, color: CGColor(gray: 0, alpha: 0.2))
let bolt = CGMutablePath()
bolt.move(to: CGPoint(x: 566, y: 890))
bolt.addLine(to: CGPoint(x: 298, y: 508))
bolt.addLine(to: CGPoint(x: 474, y: 508))
bolt.addLine(to: CGPoint(x: 414, y: 142))
bolt.addLine(to: CGPoint(x: 730, y: 586))
bolt.addLine(to: CGPoint(x: 546, y: 586))
bolt.closeSubpath()
context.addPath(bolt)
context.setFillColor(CGColor(gray: 1, alpha: 0.96))
context.fillPath()

guard let image = context.makeImage() else {
  fatalError("Unable to create the icon image")
}

let outputURL = URL(fileURLWithPath: arguments[1])
try FileManager.default.createDirectory(
  at: outputURL.deletingLastPathComponent(),
  withIntermediateDirectories: true
)
guard
  let destination = CGImageDestinationCreateWithURL(
    outputURL as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
  )
else {
  fatalError("Unable to create the PNG destination")
}

CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
  fatalError("Unable to write the PNG")
}
