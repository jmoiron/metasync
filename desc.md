I'd like to write a tool called 'metasync'

This tool will be written in Go. We should be able to use the globally installed
version.

For years I shot with a Canon 6d, which had an integrated GPS. I've upgraded to
a Canon r5 mk II, better in every way except that it has no integrated GPS. This
has led to two issues:

* some photos files have the wrong time in their EXIF data
* most photo files do not have any GPS data

The r5 mk II _can_ sync with a phone and use its GPS to populate its GPS data,
so for days when I remember to sync with the phone, I will have usable GPS data
and good timestamps.

My goal is to use a set of photos with known good timestamps and GPS data to
interpolate approximate data into the photos without them. The source for this
will be an archive of cell phone photos, as usually I will have taken a cell
phone photo at a particular location even if I was using my camera there.

My idea for the interface is a web app with two vertical panes. The left pane
has images that I want to fix, sorted by filename, and the right pane has the
"metadata source" images that I want to use to fix the other images. When the
user clicks on an image, it is "selected" and its metadata is displayed in its
side's "bottom" metadata area, which is an area that does not scroll with the
rest of the pane and is anchored to the bottom of the pane.

There should be a timeline on the left, with images in both columns arranged
into identical 15 minute chunks. It's possible that the timestamps for the left
images are corrupt or absent; we should be able to identify that this is the
case by the fact that there will be no overlap at all between the image sets.

Although the absolute timestamps for the left images are probably off, their
relative timestamps are probably correct; ie, the camera will boot up with some
default zero-date, but if photo1 is at t0, and photo2 is at t0 + 1h31m17s, then
fixing photo1's time will give us photo2's accurate time.

If the timestamps cycle within one batch of photos arranged by filename, that
means the camera's base t0 timestamp has been reset, and I will have to align
each t0 differently. When this is the case, the photos on the left side should
be batched by their associated t0; so the first batch in one segment, and then
when the time resets the next batch, and so on.

The user should be able to activate a "gps" view. This view should make a map
available on both the left and the right pane metadata area.

The map should be leaflet js (leafletjs.com) + OpenStreetMap. When a photo is
selected, its sides map should render an indicator related to its GPS location.
