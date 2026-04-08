# metasync

For years I shot with a Canon 6d, which had an integrated GPS. I've upgraded to
a Canon r5 mk II, better in every way except that it has no integrated GPS. This
has led to two issues:

* some photos files have the wrong time in their EXIF data
* most photo files do not have any GPS data

The r5 mk II _can_ sync with a phone and use its GPS to populate its GPS data,
so for days when I remember to sync with the phone, I will have usable GPS data.

Unfortunately, I often go several months without shooting, and without GPS data
to fix the factory default clock settings, my photos end up without any coordinate
data _and_ bad timestamps.

_metasync_ fixes this.

## usage

```bash
$ metasync --target photos/without/metadata/ --ref phone-photos/from/same/period
```

_metasync_ is a local web-based tool that allows you to use a known good set of
images as a kind of GPS tracker. If you have a photo in the ref set that is taken
about the same time as a photo in the target set, you can typically use that to
fix all of the photo timestamps in the target set.

From there, you can use the ref GPS coordinates to fix the target GPS coordinates
using a variety of strategies.

![](/metasync.png)

## installing

Unfortunately you will need a working Go build environment. Fortunately this is
generally pretty easy to get. Either use [go.dev/dl](https://go.dev/dl/) to download
an official package, or `brew install go`, or your other package manager of choice.

From there:

```bash
$ go install github.com/jmoiron/metasync
```

Should download, build, and place `metasync` in `$GOPATH/bin`. You may want to
add that directory to your `$PATH`.

## How it works

When you first run metasync, it will parse all of the exif data from your files
create thumbnails for them. This is typically quite fast, because most digital
photos have thumbnails already in the EXIF data, and metasync will simply extract
these if present.

From there, you're presented with the interface in the screenshot above.

If the timestamps on your images are wrong, the first and most important step is
to fix them. Hopefully, you have two images that were obviously taken at the same
place around the same time. In practice, I often do end up with this, either a
backlit exposure that I wanted to use the phone for, a selfie, etc.

Selecting a target and ref photo and clicking "Add Pair" will add this set of
photos as a synchronization pair. Clicking "apply" will adjust the timestamps on
all of the photos in scope using the delta from that pair.

But what is a scope?

### scopes

The `scope` dropdown defines 3 scopes: "global", "session", and "single image".

These scopes define how broadly the changes we've defined will apply. The default
scope is "global", and this is probably the right scope for fixing the timestamps
on a large set of photos, as typically you only need to find one good pair to
compute the delta for the rest of the photoset.

The "session" scope is a heuristic grouping of photos. Photos are in the same
session of each photo in the sequence has a time gap of less than the session
time. The default time is session time is 5 minutes, which means if photo N and
photo N+1 are taken within 5 minutes of each other, they are in the same session.
This ends up being a pretty handy way to separate out strings of photos by
where they were taken, because you are typically not snapping a lot of photos
while in transit.

The final scope is "single image", which applies changes only to the target image
that has been selected. This is useful for small fixes, like selecting a GPS
location from a map for a photo that was not part of other sessions but is in
a well known place.

## Fixing your photos

Typically, you will want to use "global" scope to fix the timestamps and to do
a first pass of GPS coordinate fixing.

There are two "auto" strategies for fixing coordinates: 

* closest reference timestamp
* interpolated position between stradling images

Lets say target image T1 is taken at `t=30`, with ref images R1 and R2 taken at
`t=10` and `t=40`. The "closest reference timestamp" strategy will simply adopt
the GPS coordinates from R2, which has a closer timestamp to T1. The interpolated
strategy will attempt to perform linear interpolation between the two coordinates,
using the timestamp of T1 to determine where along that line it should be placed.
In practice, "closest reference timestamp" works pretty well, but the interpolation
can be useful if eg. you were taking photos from a moving vehicle.

The auto-coordinate fixing has a cut-off time proximity where it won't consider a
reference photo as a match for the target photo. By default, this is 30 minutes,
but you may want to constrain this more for the global application if you are
very concerned about accuracy.

From here, you can use the "missing gps" lens (a checkbox at the top) to see what
photos still don't have GPS coordinates, and you can change the scope to session
or single-image depending on how broadly you want to apply your updates.

There are three simple fixes you can apply to the smaller scopes: "from ref image",
"from prev target", and "from map".

The "from ref image" button copies the GPS data in the selected ref image to all
of the photos in the scope. If you have photos that you know were in the same
location (eg. at the AirBnB you were staying at) but are not close in time, you
can use this to fix them.

The "from prev target" can be good when you have a brief break taking photos and
then resumed in the same location, but not close enough to any ref photos, eg.
photos taken before and after a dinner.

Finally, "from map" allows you to use the map in the metadata section under the
target photos to click on a location for that photo. If you don't have any phone
photos available, but a session or a specific photo was taken from a well known
location (eg. a landmark), you can use this to set it manually.

Up until this point, _no changes_ have been made to your photos. To apply the
changes to the files on disk, you can click the red "save" button.
